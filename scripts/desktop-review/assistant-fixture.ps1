param([string]$OutputDirectory, [string]$WindowTitle)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase, System.Drawing

$bitmap = New-Object Drawing.Bitmap(760, 400)
$graphics = [Drawing.Graphics]::FromImage($bitmap)
$graphics.Clear([Drawing.Color]::White)
$graphics.TextRenderingHint = [Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$font = New-Object Drawing.Font('Arial', 24)
$graphics.DrawString('SOPHON VISION CHECK', $font, [Drawing.Brushes]::Black, 24, 20)
$graphics.DrawString('Project: ORION', $font, [Drawing.Brushes]::Black, 24, 80)
$graphics.DrawString('Code: 7429', $font, [Drawing.Brushes]::Black, 24, 135)
foreach ($x in @(40, 140, 240)) { $graphics.FillRectangle([Drawing.Brushes]::RoyalBlue, $x, 220, 65, 65) }
foreach ($x in @(440, 550)) { $graphics.FillEllipse([Drawing.Brushes]::Crimson, $x, 220, 65, 65) }
$graphics.DrawString('Blue squares / Red circles', $font, [Drawing.Brushes]::Black, 24, 320)
$imageFile = Join-Path $OutputDirectory 'reference.png'
$bitmap.Save($imageFile, [Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
$font.Dispose()
$form = New-Object Windows.Window
$form.Title = $WindowTitle
$form.Width = 820
$form.Height = 590
$form.Left = 70
$form.Top = 70
$panel = New-Object Windows.Controls.StackPanel
$panel.Margin = '16'
$image = New-Object Windows.Controls.Image
$image.Source = New-Object Windows.Media.Imaging.BitmapImage([Uri]$imageFile)
$image.Height = 400
$panel.Children.Add($image) | Out-Null
$button = New-Object Windows.Controls.Button
$button.Content = 'Click test'
$button.Height = 40
$panel.Children.Add($button) | Out-Null
$label = New-Object Windows.Controls.TextBlock
$label.Text = 'Clicks: 0'
$label.FontSize = 22
$panel.Children.Add($label) | Out-Null
$script:clicks = 0
$button.Add_Click({
  $script:clicks++
  $label.Text = 'Clicks: ' + $script:clicks
  [IO.File]::WriteAllText((Join-Path $OutputDirectory 'clicks.txt'), [string]$script:clicks)
})
$form.Content = $panel
$form.Add_ContentRendered({
  $helper = New-Object Windows.Interop.WindowInteropHelper($form)
  [Console]::Out.WriteLine((@{ hwnd = $helper.Handle.ToInt64(); pid = $PID } | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
})
[void]$form.ShowDialog()
