using System;
using System.Drawing;
using System.Windows.Forms;

namespace PersonalAgent.WindowsFixture;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new FixtureWindow());
    }
}

internal sealed class FixtureWindow : Form
{
    public FixtureWindow()
    {
        Text = "Personal Agent Phase 5 Fixture";
        Width = 540;
        Height = 300;
        StartPosition = FormStartPosition.CenterScreen;
        var input = new TextBox { Name = "FixtureInput", Left = 20, Top = 24, Width = 450, AccessibleName = "Fixture input" };
        var button = new Button { Name = "FixtureButton", Text = "Update status", Left = 20, Top = 70, Width = 150 };
        var check = new CheckBox { Name = "FixtureCheck", Text = "Fixture check", Left = 200, Top = 75, Width = 150 };
        var status = new Label { Name = "FixtureStatus", Text = "Ready", Left = 20, Top = 125, Width = 450 };
        var secret = new TextBox { Name = "FixturePassword", Left = 20, Top = 165, Width = 220, UseSystemPasswordChar = true, Text = "synthetic-password-fixture", AccessibleName = "Password" };
        button.Click += (_, _) => status.Text = $"Updated: {input.Text}";
        Controls.Add(input);
        Controls.Add(button);
        Controls.Add(check);
        Controls.Add(status);
        Controls.Add(secret);
    }
}
