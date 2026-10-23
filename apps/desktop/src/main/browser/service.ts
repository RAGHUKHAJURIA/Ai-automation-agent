import { lookup } from 'node:dns/promises';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { z } from 'zod';
import type { DesktopFileService } from '../filesystem/service.js';
import {
  isRestrictedHost,
  validateBrowserUrl,
  classifyBrowserAction,
  sanitizeDownloadFilename,
  normalizeDomainRule,
  isDomainAllowed,
} from './security.js';

const pageInput = z.object({ pageId: z.string().uuid() }).strict();
const elementInput = z
  .object({
    pageId: z.string().uuid(),
    elementRef: z.string().uuid(),
    snapshotId: z.string().uuid(),
  })
  .strict();
const maxTextChars = 12_000;
const maxElements = 100;
const navigationTimeoutMs = 20_000;
const actionTimeoutMs = 8_000;
const maxDownloadBytes = 32_000_000;
const maxUploadBytes = 32_000_000;
const maxPages = 10;
const blockedDownloadExtensions = new Set([
  '.exe',
  '.msi',
  '.bat',
  '.cmd',
  '.ps1',
  '.scr',
  '.com',
  '.dll',
]);
export interface BrowserAutomationOptions {
  allowPrivateFixture?: boolean;
  headless?: boolean;
  profilePath?: string;
}

type ElementRecord = {
  ref: string;
  snapshotId: string;
  selector: string;
  index: number;
  kind: string;
  name: string;
  type: string;
  risk: string;
  formIndex: number | null;
};
type PageRecord = {
  page: Page;
  pageId: string;
  url: string;
  title: string;
  revision: number;
  elements: Map<string, ElementRecord>;
  snapshotId: string | undefined;
  navigationDeniedUrl: string | undefined;
};

export class BrowserAutomationService {
  private context: BrowserContext | undefined;
  private readonly pages = new Map<string, PageRecord>();
  private readonly allowedDomains = new Set<string>();
  private emergencyStopped = false;
  private paused = false;
  private waitingState: 'READY' | 'WAITING_FOR_AUTH' | 'WAITING_FOR_OWNER' = 'READY';

  constructor(
    private readonly userDataPath: string,
    private readonly options: BrowserAutomationOptions = {},
    private readonly files?: DesktopFileService,
  ) {}

  setEmergencyStopped(stopped: boolean): void {
    this.emergencyStopped = stopped;
  }
  setPaused(paused: boolean): void {
    this.paused = paused;
  }
  isRunning(): boolean {
    return Boolean(this.context);
  }
  status() {
    return {
      running: Boolean(this.context),
      state: this.emergencyStopped
        ? 'EMERGENCY_STOPPED'
        : this.paused
          ? 'PAUSED'
          : this.waitingState,
      pages: [...this.pages.values()]
        .filter((record) => !record.page.isClosed())
        .map(({ pageId, url, title }) => ({ pageId, url, origin: safeOrigin(url), title })),
    };
  }

  async focusActivePage(): Promise<{ focused: boolean }> {
    const page = this.context
      ?.pages()
      .filter((candidate) => !candidate.isClosed())
      .at(-1);
    if (!page) return { focused: false };
    await page.bringToFront();
    return { focused: true };
  }

  async resetProfile(): Promise<void> {
    await this.close();
    const root = path.resolve(this.userDataPath);
    const profile = path.resolve(root, 'browser', 'profiles', 'primary');
    if (path.relative(root, profile) !== path.join('browser', 'profiles', 'primary'))
      throw new BrowserOperationError('PROFILE_PATH_INVALID');
    await rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
    this.allowedDomains.clear();
    this.waitingState = 'READY';
  }

  async close(): Promise<void> {
    this.pages.clear();
    const context = this.context;
    this.context = undefined;
    if (context) await context.close().catch(() => undefined);
  }

  async open(input: unknown, signal?: AbortSignal) {
    const args = z
      .object({
        url: z.string().url(),
        authorizedDomains: z.array(z.string().min(1).max(253)).max(100).default([]),
      })
      .strict()
      .parse(input);
    this.assertMayAct(signal);
    for (const domain of args.authorizedDomains)
      this.allowedDomains.add(normalizeDomainRule(domain));
    const url = await this.authorizeUrl(args.url);
    if (!isDomainAllowed(url.hostname, [...this.allowedDomains]))
      throw new BrowserOperationError('DOMAIN_NOT_ALLOWED');
    const context = await this.ensureContext();
    const page =
      context
        .pages()
        .find((candidate) => !candidate.isClosed() && candidate.url() === 'about:blank') ??
      (await context.newPage());
    const record = this.register(page);
    try {
      await page.goto(url.toString(), {
        waitUntil: 'domcontentloaded',
        timeout: navigationTimeoutMs,
      });
      this.assertMayAct(signal);
      if (record.navigationDeniedUrl) {
        record.navigationDeniedUrl = undefined;
        throw new BrowserOperationError('NAVIGATION_DENIED');
      }
      await this.authorizeUrl(page.url());
      await this.updateRecord(record);
      this.waitingState = 'READY';
      return {
        pageId: record.pageId,
        url: record.url,
        title: record.title,
        origin: new URL(record.url).origin,
      };
    } catch (error) {
      if (record.page.isClosed()) this.pages.delete(record.pageId);
      if (record.navigationDeniedUrl) {
        record.navigationDeniedUrl = undefined;
        throw new BrowserOperationError('NAVIGATION_DENIED');
      }
      throw normalizeBrowserError(error);
    }
  }

  async inspect(input: unknown, signal?: AbortSignal) {
    const { pageId } = pageInput.parse(input);
    this.assertMayAct(signal);
    const record = this.requirePage(pageId);
    await this.authorizeUrl(record.page.url());
    const snapshotId = randomUUID();
    const observed = await record.page.evaluate(
      ({ limit, textLimit }) => {
        const visible = (element: Element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return (
            style.visibility !== 'hidden' &&
            style.display !== 'none' &&
            rect.width > 0 &&
            rect.height > 0
          );
        };
        const nameOf = (element: Element) => {
          const id = element.getAttribute('id');
          const label = id
            ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent
            : null;
          return (
            element.getAttribute('aria-label') ||
            label ||
            element.closest('label')?.textContent ||
            element.getAttribute('placeholder') ||
            element.textContent ||
            element.getAttribute('title') ||
            ''
          )
            .trim()
            .slice(0, 180);
        };
        const selectors =
          'button,a,input,textarea,select,[contenteditable="true"],[role="button"],[role="checkbox"],[role="radio"]';
        const controls = Array.from(document.querySelectorAll(selectors))
          .map((element, index) => ({ element, index }))
          .filter(({ element }) => visible(element))
          .slice(0, limit)
          .map(({ element, index }) => {
            const input = element as HTMLInputElement;
            const kind =
              element.tagName.toLowerCase() === 'a'
                ? 'link'
                : element.tagName.toLowerCase() === 'button' ||
                    element.getAttribute('role') === 'button' ||
                    ['button', 'submit', 'reset', 'image'].includes(input.type)
                  ? 'button'
                  : 'field';
            const form = element.closest('form');
            return {
              index,
              selector: selectors,
              kind,
              name: nameOf(element),
              type: input.type || element.tagName.toLowerCase(),
              fieldName: element.getAttribute('name') || undefined,
              required: Boolean(input.required || element.getAttribute('aria-required') === 'true'),
              disabled: Boolean(input.disabled || element.getAttribute('aria-disabled') === 'true'),
              checked:
                typeof input.checked === 'boolean' && ['checkbox', 'radio'].includes(input.type)
                  ? input.checked
                  : undefined,
              invalid:
                'validity' in input
                  ? !input.validity.valid
                  : element.getAttribute('aria-invalid') === 'true',
              hasValue: Boolean(input.value || element.textContent),
              formIndex: form ? Array.from(document.forms).indexOf(form as HTMLFormElement) : null,
            };
          });
        const messages = Array.from(
          document.querySelectorAll(
            '[role="alert"], [aria-live="assertive"], [aria-invalid="true"]',
          ),
        )
          .filter(visible)
          .slice(0, 30)
          .map((element) => {
            const describedBy = element
              .getAttribute('aria-describedby')
              ?.split(/\s+/)
              .map((id) => document.getElementById(id)?.textContent || '')
              .join(' ');
            const message =
              describedBy ||
              element.textContent ||
              ('validationMessage' in element
                ? (element as HTMLInputElement).validationMessage
                : '');
            return {
              fieldName: element.getAttribute('name') || undefined,
              message: message.trim().slice(0, 300),
              invalid:
                element.getAttribute('aria-invalid') === 'true' ||
                ('validity' in element && !(element as HTMLInputElement).validity.valid),
            };
          });
        const forms = Array.from(document.forms)
          .filter(visible)
          .slice(0, 30)
          .map((form, index) => ({
            index,
            action: form.action,
            method: form.method.toUpperCase(),
            fieldCount: form.querySelectorAll('input,textarea,select,[contenteditable="true"]')
              .length,
          }));
        const body = document.body?.innerText || '';
        const pageText = body.slice(0, textLimit);
        const login =
          Boolean(document.querySelector('input[type="password"]')) ||
          /\/login(?:\/|$)|\/signin(?:\/|$)|\/auth(?:\/|$)/i.test(location.pathname);
        const challenge =
          /captcha|security challenge|verify you are human|security key|passkey|one[- ]time code|verification code|two[- ]factor|2fa|authenticator/i.test(
            pageText,
          ) ||
          Boolean(
            document.querySelector(
              '[autocomplete="one-time-code"], input[name*="otp" i], input[name*="mfa" i]',
            ),
          );
        return {
          title: document.title.slice(0, 300),
          text: pageText,
          controls,
          messages,
          forms,
          truncated: body.length > textLimit,
          login,
          challenge,
        };
      },
      { limit: maxElements, textLimit: maxTextChars },
    );
    record.snapshotId = snapshotId;
    record.elements.clear();
    const formRefs = new Map<number, string>();
    const forms = observed.forms.map((form) => {
      const formRef = randomUUID();
      formRefs.set(form.index, formRef);
      return { formRef, action: form.action, method: form.method, fieldCount: form.fieldCount };
    });
    const elements = observed.controls.map((element) => {
      const ref = randomUUID();
      const risk = classifyBrowserAction(element.kind, element.name, element.type);
      record.elements.set(ref, {
        ref,
        snapshotId,
        selector: element.selector,
        index: element.index,
        kind: element.kind,
        name: element.name,
        type: element.type,
        risk,
        formIndex: element.formIndex,
      });
      return {
        elementRef: ref,
        formRef: element.formIndex === null ? undefined : formRefs.get(element.formIndex),
        role: element.kind,
        label: element.name || undefined,
        name: element.fieldName,
        type: element.type,
        required: element.required,
        disabled: element.disabled,
        checked: element.checked,
        invalid: element.invalid,
        hasValue: element.hasValue,
        actionRisk: risk,
      };
    });
    await this.updateRecord(record);
    const pageState = observed.challenge
      ? 'WAITING_FOR_OWNER'
      : observed.login
        ? 'WAITING_FOR_AUTH'
        : 'READY';
    this.waitingState = pageState;
    return {
      pageId,
      snapshotId,
      navigationRevision: record.revision,
      url: record.url,
      origin: new URL(record.url).origin,
      title: observed.title,
      visibleText: observed.text,
      textTruncated: observed.truncated,
      forms,
      interactiveElements: elements,
      validationMessages: observed.messages,
      pageState,
      contentTrust: 'UNTRUSTED_EXTERNAL_CONTENT',
    };
  }

  async read(input: unknown, signal?: AbortSignal) {
    const { pageId } = pageInput.parse(input);
    this.assertMayAct(signal);
    const record = this.requirePage(pageId);
    await this.authorizeUrl(record.page.url());
    const content = await record.page.locator('body').innerText({ timeout: actionTimeoutMs });
    await this.updateRecord(record);
    return {
      pageId,
      url: record.url,
      title: record.title,
      observedAt: new Date().toISOString(),
      text: content.slice(0, maxTextChars),
      contentTrust: 'UNTRUSTED_EXTERNAL_CONTENT',
    };
  }

  async fill(input: unknown, signal?: AbortSignal) {
    const args = elementInput
      .extend({ value: z.string().max(4_000) })
      .strict()
      .parse(input);
    this.assertMayAct(signal);
    const { record, element, locator } = await this.resolve(args);
    if (element.type.toLowerCase() === 'password') throw new BrowserOperationError('AUTH_REQUIRED');
    if (!['field'].includes(element.kind)) throw new BrowserOperationError('ELEMENT_NOT_EDITABLE');
    await locator.fill(args.value, { timeout: actionTimeoutMs });
    this.assertMayAct(signal);
    const value = await locator.evaluate((node) =>
      'value' in node ? String(node.value) : (node.textContent ?? ''),
    );
    if (value !== args.value) throw new BrowserOperationError('ACTION_NOT_VERIFIED');
    await this.updateRecord(record);
    return {
      pageId: args.pageId,
      elementRef: element.ref,
      verified: true,
      valueLength: value.length,
    };
  }

  async check(input: unknown, signal?: AbortSignal) {
    const args = elementInput.extend({ checked: z.boolean() }).strict().parse(input);
    this.assertMayAct(signal);
    const { record, element, locator } = await this.resolve(args);
    if (!['checkbox', 'radio'].includes(element.type.toLowerCase()))
      throw new BrowserOperationError('ELEMENT_NOT_CHECKABLE');
    if (element.type.toLowerCase() === 'radio' && !args.checked)
      throw new BrowserOperationError('RADIO_CANNOT_UNCHECK');
    if (args.checked) await locator.check({ timeout: actionTimeoutMs });
    else await locator.uncheck({ timeout: actionTimeoutMs });
    this.assertMayAct(signal);
    if ((await locator.isChecked()) !== args.checked)
      throw new BrowserOperationError('ACTION_NOT_VERIFIED');
    await this.updateRecord(record);
    return { pageId: args.pageId, elementRef: element.ref, checked: args.checked, verified: true };
  }

  async select(input: unknown, signal?: AbortSignal) {
    const args = elementInput
      .extend({ value: z.string().max(500) })
      .strict()
      .parse(input);
    this.assertMayAct(signal);
    const { record, element, locator } = await this.resolve(args);
    if (!['select-one', 'select-multiple', 'select'].includes(element.type.toLowerCase()))
      throw new BrowserOperationError('ELEMENT_NOT_SELECT');
    await locator.selectOption(args.value, { timeout: actionTimeoutMs });
    this.assertMayAct(signal);
    const selected = await locator.inputValue({ timeout: actionTimeoutMs });
    if (selected !== args.value) throw new BrowserOperationError('ACTION_NOT_VERIFIED');
    await this.updateRecord(record);
    return {
      pageId: args.pageId,
      elementRef: element.ref,
      selectedValue: selected,
      verified: true,
    };
  }

  async click(input: unknown, signal?: AbortSignal) {
    const args = elementInput.parse(input);
    this.assertMayAct(signal);
    const { record, element, locator } = await this.resolve(args);
    if (
      [
        'SUBMIT_LIKE',
        'DELETE_LIKE',
        'PURCHASE_LIKE',
        'SEND_LIKE',
        'UNKNOWN_CONSEQUENTIAL',
      ].includes(element.risk)
    )
      return {
        outcome: 'NEEDS_INPUT',
        errorCode: 'SUBMISSION_APPROVAL_NOT_INTEGRATED',
        actionRisk: element.risk,
        elementRef: element.ref,
      };
    const beforeUrl = record.page.url();
    const beforeText = (
      await record.page
        .locator('body')
        .innerText({ timeout: actionTimeoutMs })
        .catch(() => '')
    ).slice(0, maxTextChars);
    const opensPopup = (await locator.getAttribute('target').catch(() => null)) === '_blank';
    const previousPages = new Set(this.context?.pages() ?? []);
    let popup: Page | undefined;
    const onPopup = (page: Page) => {
      popup = page;
    };
    const popupEvent = opensPopup
      ? record.page.waitForEvent('popup', { timeout: actionTimeoutMs }).catch(() => undefined)
      : undefined;
    record.page.once('popup', onPopup);
    try {
      await locator.click({ timeout: actionTimeoutMs, noWaitAfter: opensPopup });
    } catch (error) {
      record.page.off('popup', onPopup);
      if (record.navigationDeniedUrl) {
        record.navigationDeniedUrl = undefined;
        throw new BrowserOperationError('NAVIGATION_DENIED');
      }
      throw normalizeBrowserError(error);
    }
    this.assertMayAct(signal);
    record.page.off('popup', onPopup);
    if (popupEvent) popup = await popupEvent;
    popup ??= this.context?.pages().find((page) => !previousPages.has(page));
    if (popup) {
      const popupRecord = this.register(popup);
      await popup
        .waitForLoadState('domcontentloaded', { timeout: navigationTimeoutMs })
        .catch(() => undefined);
      try {
        await this.authorizeUrl(popup.url());
      } catch {
        await popup.close().catch(() => undefined);
        throw new BrowserOperationError('NAVIGATION_DENIED');
      }
      await this.updateRecord(popupRecord);
      return {
        pageId: args.pageId,
        popup: {
          pageId: popupRecord.pageId,
          url: popupRecord.url,
          title: popupRecord.title,
          origin: new URL(popupRecord.url).origin,
        },
        actionRisk: element.risk,
        verified: true,
      };
    }
    await record.page
      .waitForLoadState('domcontentloaded', { timeout: 3_000 })
      .catch(() => undefined);
    const nextUrl = record.page.url();
    if (record.navigationDeniedUrl) {
      record.navigationDeniedUrl = undefined;
      throw new BrowserOperationError('NAVIGATION_DENIED');
    }
    await this.authorizeUrl(nextUrl);
    const afterText = (
      await record.page
        .locator('body')
        .innerText({ timeout: actionTimeoutMs })
        .catch(() => '')
    ).slice(0, maxTextChars);
    if (beforeUrl === nextUrl && beforeText === afterText)
      throw new BrowserOperationError('ACTION_NOT_VERIFIED');
    await this.updateRecord(record);
    return {
      pageId: args.pageId,
      elementRef: element.ref,
      actionRisk: element.risk,
      beforeUrl,
      url: nextUrl,
      navigated: nextUrl !== beforeUrl,
      verified: true,
    };
  }

  async upload(input: unknown, signal?: AbortSignal) {
    const args = elementInput
      .extend({
        files: z
          .array(
            z
              .object({
                rootId: z.string().regex(/^root_[a-f0-9]{32}$/),
                relativePath: z.string().min(1).max(1024),
                expectedHash: z
                  .string()
                  .regex(/^[a-f0-9]{64}$/)
                  .optional(),
              })
              .strict(),
          )
          .min(1)
          .max(4),
      })
      .strict()
      .parse(input);
    this.assertMayAct(signal);
    if (!this.files) throw new BrowserOperationError('NOT_CONFIGURED');
    const { record, element, locator } = await this.resolve(args);
    const type = await locator.getAttribute('type');
    if (element.type.toLowerCase() !== 'file' || type?.toLowerCase() !== 'file')
      throw new BrowserOperationError('ELEMENT_NOT_FILE_INPUT');
    const payloads: Array<{
      name: string;
      mimeType: string;
      buffer: Buffer;
      sha256: string;
      size: number;
    }> = [];
    let totalBytes = 0;
    for (const file of args.files) {
      this.assertMayAct(signal);
      const loaded = await this.files.readBinaryForUpload(
        {
          rootId: file.rootId,
          relativePath: file.relativePath,
          ...(file.expectedHash ? { expectedHash: file.expectedHash } : {}),
        },
        signal,
      );
      totalBytes += loaded.size;
      if (loaded.size > maxUploadBytes || totalBytes > maxUploadBytes)
        throw new BrowserOperationError('UPLOAD_TOO_LARGE');
      payloads.push({
        name: loaded.filename,
        mimeType: mimeTypeFor(loaded.filename),
        buffer: loaded.bytes,
        sha256: loaded.sha256,
        size: loaded.size,
      });
    }
    await locator.setInputFiles(
      payloads.map(({ name, mimeType, buffer }) => ({ name, mimeType, buffer })),
      { timeout: actionTimeoutMs },
    );
    this.assertMayAct(signal);
    const selected = await locator.evaluate((node) =>
      Array.from((node as HTMLInputElement).files ?? []).map((file) => ({
        name: file.name,
        size: file.size,
      })),
    );
    if (
      selected.length !== payloads.length ||
      selected.some(
        (file, index) => file.name !== payloads[index]?.name || file.size !== payloads[index]?.size,
      )
    )
      throw new BrowserOperationError('UPLOAD_NOT_VERIFIED');
    await this.updateRecord(record);
    return {
      pageId: args.pageId,
      files: payloads.map(({ name, size, sha256 }) => ({ filename: name, size, sha256 })),
      selected: true,
      uploadMayHaveSideEffect: true,
    };
  }

  async download(input: unknown, signal?: AbortSignal) {
    const args = elementInput
      .extend({
        destinationRootId: z.string().regex(/^root_[a-f0-9]{32}$/),
        destinationRelativeDirectory: z.string().max(1024).default('.'),
      })
      .strict()
      .parse(input);
    this.assertMayAct(signal);
    if (!this.files) throw new BrowserOperationError('NOT_CONFIGURED');
    const { record, element, locator } = await this.resolve(args);
    if (!['NAVIGATION', 'NON_CONSEQUENTIAL'].includes(element.risk))
      throw new BrowserOperationError('DOWNLOAD_ACTION_REQUIRES_APPROVAL');
    const downloadEvent = record.page.waitForEvent('download', { timeout: 30_000 });
    try {
      await locator.click({ timeout: actionTimeoutMs });
      const download = await downloadEvent;
      this.assertMayAct(signal);
      const filename = sanitizeDownloadFilename(download.suggestedFilename());
      if (blockedDownloadExtensions.has(path.extname(filename).toLowerCase()))
        throw new BrowserOperationError('DOWNLOAD_TYPE_DENIED');
      const temporaryPath = await download.path();
      if (!temporaryPath) throw new BrowserOperationError('DOWNLOAD_INTERRUPTED');
      const fileInfo = await stat(temporaryPath);
      if (fileInfo.size > maxDownloadBytes) throw new BrowserOperationError('DOWNLOAD_TOO_LARGE');
      const bytes = await readFile(temporaryPath);
      if (bytes.byteLength > maxDownloadBytes)
        throw new BrowserOperationError('DOWNLOAD_TOO_LARGE');
      const relativePath =
        args.destinationRelativeDirectory === '.'
          ? filename
          : path.posix.join(args.destinationRelativeDirectory.replaceAll('\\', '/'), filename);
      const saved = await this.files.writeDownloadedFile(
        { rootId: args.destinationRootId, relativePath, bytes, expectedHash: await sha256(bytes) },
        signal,
      );
      await this.updateRecord(record);
      return { pageId: args.pageId, ...saved, contentType: mimeTypeFor(filename), verified: true };
    } catch (error) {
      void downloadEvent.catch(() => undefined);
      throw normalizeBrowserError(error);
    }
  }

  async listPages() {
    return [...this.pages.values()]
      .filter((record) => !record.page.isClosed())
      .map((record) => ({
        pageId: record.pageId,
        url: record.page.url(),
        title: record.title,
        active: record.page === this.context?.pages().at(-1),
      }));
  }

  async switchPage(input: unknown) {
    const { pageId } = pageInput.parse(input);
    const record = this.requirePage(pageId);
    await record.page.bringToFront();
    return { pageId, url: record.page.url(), title: record.title };
  }

  async closePage(input: unknown) {
    const { pageId } = pageInput.parse(input);
    const record = this.requirePage(pageId);
    await record.page.close();
    this.pages.delete(pageId);
    return { pageId, closed: true };
  }

  private async ensureContext(): Promise<BrowserContext> {
    if (this.context && this.context.pages().some((page) => !page.isClosed())) return this.context;
    const profile =
      this.options.profilePath ?? path.join(this.userDataPath, 'browser', 'profiles', 'primary');
    await mkdir(profile, { recursive: true, mode: 0o700 });
    const launchOptions = {
      headless: this.options.headless ?? false,
      chromiumSandbox: true,
      acceptDownloads: true,
      serviceWorkers: 'block' as const,
      timeout: 30_000,
      ...(this.options.headless ? { channel: 'chromium' as const } : {}),
    };
    const context = await chromium.launchPersistentContext(profile, launchOptions);
    this.context = context;
    await context.route('**/*', (route) => this.routeRequest(route));
    context.on('page', (page) => {
      if (context.pages().length > maxPages) {
        void page.close();
        return;
      }
      this.register(page);
    });
    context.on('close', () => {
      this.context = undefined;
      this.pages.clear();
    });
    context.on('page', (page) =>
      page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) {
          const record = [...this.pages.values()].find((candidate) => candidate.page === page);
          if (record) {
            record.revision += 1;
            record.elements.clear();
            record.snapshotId = undefined;
          }
        }
      }),
    );
    for (const page of context.pages()) this.register(page);
    return context;
  }

  private register(page: Page): PageRecord {
    const existing = [...this.pages.values()].find((record) => record.page === page);
    if (existing) return existing;
    const record: PageRecord = {
      page,
      pageId: randomUUID(),
      url: page.url(),
      title: '',
      revision: 0,
      elements: new Map(),
      snapshotId: undefined,
      navigationDeniedUrl: undefined,
    };
    this.pages.set(record.pageId, record);
    page.on('close', () => this.pages.delete(record.pageId));
    page.on('dialog', (dialog) => {
      if (dialog.type() === 'alert') void dialog.accept();
      else void dialog.dismiss();
    });
    return record;
  }

  private async updateRecord(record: PageRecord): Promise<void> {
    record.url = record.page.url();
    record.title = await record.page.title().catch(() => '');
  }
  private requirePage(pageId: string): PageRecord {
    const record = this.pages.get(pageId);
    if (!record || record.page.isClosed()) throw new BrowserOperationError('PAGE_NOT_FOUND');
    return record;
  }

  private async resolve(args: z.infer<typeof elementInput>) {
    const record = this.requirePage(args.pageId);
    if (record.snapshotId !== args.snapshotId) throw new BrowserOperationError('STALE_OBSERVATION');
    const element = record.elements.get(args.elementRef);
    if (!element || element.snapshotId !== args.snapshotId)
      throw new BrowserOperationError('STALE_OBSERVATION');
    const locator = record.page.locator(element.selector).nth(element.index);
    const matches = await locator.count().catch(() => 0);
    if (matches !== 1) throw new BrowserOperationError('STALE_OBSERVATION');
    const current = await locator
      .evaluate((node) => {
        const input = node as HTMLInputElement;
        const id = node.getAttribute('id');
        const label = id
          ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent
          : null;
        const kind =
          node.tagName.toLowerCase() === 'a'
            ? 'link'
            : node.tagName.toLowerCase() === 'button' ||
                node.getAttribute('role') === 'button' ||
                ['button', 'submit', 'reset', 'image'].includes(input.type)
              ? 'button'
              : 'field';
        return {
          type: input.type || node.tagName.toLowerCase(),
          kind,
          name: (
            node.getAttribute('aria-label') ||
            label ||
            node.closest('label')?.textContent ||
            node.getAttribute('placeholder') ||
            node.textContent ||
            node.getAttribute('title') ||
            ''
          )
            .trim()
            .slice(0, 180),
        };
      })
      .catch(() => null);
    if (
      !current ||
      current.type !== element.type ||
      current.kind !== element.kind ||
      current.name !== element.name
    )
      throw new BrowserOperationError('STALE_OBSERVATION');
    return { record, element, locator };
  }

  private assertMayAct(signal?: AbortSignal): void {
    if (signal?.aborted) throw new BrowserOperationError('CANCELLED');
    if (this.emergencyStopped) throw new BrowserOperationError('DEVICE_STOPPED');
    if (this.paused) throw new BrowserOperationError('DEVICE_PAUSED');
  }

  private async authorizeUrl(rawUrl: string): Promise<URL> {
    const url = validateBrowserUrl(rawUrl, this.options.allowPrivateFixture ?? false);
    if (url.hostname && !this.options.allowPrivateFixture) {
      const addresses = await lookup(url.hostname, { all: true }).catch(() => []);
      if (!addresses.length || addresses.some(({ address }) => isRestrictedHost(address)))
        throw new BrowserOperationError('PRIVATE_NETWORK_DENIED');
    }
    return url;
  }

  private async routeRequest(route: import('playwright').Route): Promise<void> {
    const request = route.request();
    try {
      const url = await this.authorizeUrl(request.url());
      if (!isDomainAllowed(url.hostname, [...this.allowedDomains]))
        throw new BrowserOperationError('DOMAIN_NOT_ALLOWED');
      await route.continue();
    } catch {
      try {
        if (request.isNavigationRequest()) {
          const frame = request.frame();
          if (frame === frame.page().mainFrame()) {
            const pageRecord = [...this.pages.values()].find(({ page }) => page === frame.page());
            if (pageRecord) pageRecord.navigationDeniedUrl = request.url();
          }
        }
      } catch {
        /* Detached and non-page requests are simply aborted. */
      }
      await route.abort('blockedbyclient').catch(() => undefined);
    }
  }
}

export class BrowserOperationError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
function normalizeBrowserError(error: unknown): Error {
  if (error instanceof BrowserOperationError) return error;
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  )
    return new BrowserOperationError(error.code);
  if (error instanceof Error && /timeout/i.test(error.message))
    return new BrowserOperationError('NAVIGATION_TIMEOUT');
  return new BrowserOperationError('BROWSER_OPERATION_FAILED');
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
function mimeTypeFor(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return (
    (
      {
        '.pdf': 'application/pdf',
        '.txt': 'text/plain',
        '.csv': 'text/csv',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
      } as Record<string, string>
    )[ext] ?? 'application/octet-stream'
  );
}
function safeOrigin(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).origin;
  } catch {
    return null;
  }
}
