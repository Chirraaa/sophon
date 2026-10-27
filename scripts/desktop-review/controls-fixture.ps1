$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase
[xml]$xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" Title="Sophon isolated controls fixture" Width="480" Height="590" Left="40" Top="40">
 <StackPanel Margin="20">
  <GroupBox Header="Draft controls"><StackPanel>
   <TextBox Name="Draft" AutomationProperties.Name="Draft message" Text="original draft" Height="28" />
   <Button Name="Apply" Content="Apply draft" Margin="0,8" Height="28" />
  </StackPanel></GroupBox>
  <TextBlock Name="Result" Text="Not applied" Height="40" />
  <CheckBox Name="Option" Content="Fixture option" Height="28" />
  <PasswordBox Name="Secret" AutomationProperties.Name="Secret fixture" Height="28" />
  <ListBox Height="60" Margin="0,8"><ListBoxItem Content="Choice one" /><ListBoxItem Content="Choice two" /></ListBox>
  <Expander Header="Fixture details" Margin="0,8"><TextBlock Text="Expanded fixture content" /></Expander>
  <ScrollViewer AutomationProperties.Name="Fixture scroll" Height="60" VerticalScrollBarVisibility="Auto">
   <StackPanel><TextBlock Text="Line 1" Height="35" /><TextBlock Text="Line 2" Height="35" /><TextBlock Text="Line 3" Height="35" /><TextBlock Text="Line 4" Height="35" /><TextBlock Text="Line 5" Height="35" /><TextBlock Text="Line 6" Height="35" /></StackPanel>
  </ScrollViewer>
 </StackPanel>
</Window>
'@
$reader = New-Object Xml.XmlNodeReader($xaml)
$form = [Windows.Markup.XamlReader]::Load($reader)
$field = $form.FindName('Draft')
$label = $form.FindName('Result')
$form.FindName('Secret').Password = 'PASSWORD_CANARY_NEVER_EXPOSE'
$form.FindName('Apply').Add_Click({ $label.Text = 'Applied: ' + $field.Text })
$form.Add_ContentRendered({
  $helper = New-Object Windows.Interop.WindowInteropHelper($form)
  [Console]::Out.WriteLine((@{ hwnd = $helper.Handle.ToInt64(); pid = $PID } | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
})
[void]$form.ShowDialog()
