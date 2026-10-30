$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

# Persistent worker: load assemblies once, then answer one JSON request per line.
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase
function Short([string]$value) {
  if ($value.Length -gt 240) { return $value.Substring(0, 240) }
  return $value
}
function Pattern($element, $id) {
  $pattern = $null
  if ($element.TryGetCurrentPattern($id, [ref]$pattern)) { return $pattern }
  return $null
}
function Describe($element) {
  $info = $element.Cached
  if ($info.IsPassword -or $info.IsOffscreen) { return $null }
  $rect = $info.BoundingRectangle
  if ($rect.IsEmpty -or $rect.Width -le 0 -or $rect.Height -le 0) { return $null }
  foreach ($coordinate in @($rect.X, $rect.Y, $rect.Width, $rect.Height)) {
    if ([double]::IsNaN($coordinate) -or [double]::IsInfinity($coordinate)) { return $null }
  }
  $ops = New-Object 'System.Collections.Generic.List[string]'
  $value = ''
  $valueHash = ''
  $valueTruncated = $false
  $selected = ''
  $toggle = ''
  $expanded = ''
  $vertical = -1
  if (Pattern $element ([Windows.Automation.InvokePattern]::Pattern)) { $ops.Add('invoke') }
  $vp = Pattern $element ([Windows.Automation.ValuePattern]::Pattern)
  if ($vp) {
    $full = [string]$vp.Current.Value
    $value = Short $full
    $valueTruncated = $full.Length -gt 240
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $valueHash = [Convert]::ToBase64String($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($full))) } finally { $sha.Dispose() }
    if (-not $vp.Current.IsReadOnly) { $ops.Add('set_value') }
  } else {
    $tp = Pattern $element ([Windows.Automation.TextPattern]::Pattern)
    if ($tp) { $full = $tp.DocumentRange.GetText(241); $value = Short $full; $valueTruncated = $full.Length -gt 240 }
  }
  $sp = Pattern $element ([Windows.Automation.SelectionItemPattern]::Pattern)
  if ($sp) { $selected = [string]$sp.Current.IsSelected; $ops.Add('select') }
  $tp = Pattern $element ([Windows.Automation.TogglePattern]::Pattern)
  if ($tp) { $toggle = [string]$tp.Current.ToggleState; $ops.Add('toggle') }
  $ep = Pattern $element ([Windows.Automation.ExpandCollapsePattern]::Pattern)
  if ($ep -and $ep.Current.ExpandCollapseState -ne 'LeafNode') {
    $expanded = [string]$ep.Current.ExpandCollapseState
    $ops.Add('expand'); $ops.Add('collapse')
  }
  $scroll = Pattern $element ([Windows.Automation.ScrollPattern]::Pattern)
  if ($scroll -and $scroll.Current.VerticallyScrollable) {
    $vertical = $scroll.Current.VerticalScrollPercent
    $ops.Add('scroll_up'); $ops.Add('scroll_down')
  }
  return [ordered]@{
    runtime = @($element.GetRuntimeId()); name = Short $info.Name
    automationId = Short $info.AutomationId; role = $info.ControlType.ProgrammaticName.Replace('ControlType.', '')
    enabled = [bool]$info.IsEnabled; value = $value; valueHash = $valueHash; valueTruncated = $valueTruncated
    selected = $selected; toggle = $toggle; expanded = $expanded; vertical = $vertical
    bounds = @([Math]::Round($rect.X), [Math]::Round($rect.Y), [Math]::Round($rect.Width), [Math]::Round($rect.Height))
    actions = @($ops.ToArray())
  }
}
function Handle($request) {
$clock = [Diagnostics.Stopwatch]::StartNew()
$script:attempted = $false
try {
  $root = [Windows.Automation.AutomationElement]::FromHandle([IntPtr][long]$request.hwnd)
  if (-not $root -or $root.Current.ProcessId -ne $request.pid) { throw 'The target application changed.' }
  # Fetch common properties together rather than crossing processes for every
  # name, role, rectangle and state. Patterns still use live values for actions.
  $cache = New-Object Windows.Automation.CacheRequest
  foreach ($property in @('NameProperty', 'AutomationIdProperty', 'ControlTypeProperty', 'IsEnabledProperty', 'IsOffscreenProperty', 'IsPasswordProperty', 'BoundingRectangleProperty')) {
    $cache.Add([Windows.Automation.AutomationElement]::$property)
  }
  $root = $root.GetUpdatedCache($cache)
  $offset = if ($request.offset) { [int]$request.offset } else { 0 }
  if ($offset -lt 0 -or $offset -gt 1000) { throw 'Invalid control offset.' }
  $scanLimit = if ($request.operation -eq 'act' -or $request.query -or $offset -gt 0) { 1200 } else { 240 }
  $walker = [Windows.Automation.TreeWalker]::ControlViewWalker
  $queue = New-Object System.Collections.Queue
  $queue.Enqueue(@($root, 0, $false, ''))
  $items = New-Object System.Collections.ArrayList
  $visited = 0
  $limited = $false
  $found = $null
  $description = $null
  $matched = 0
  while ($queue.Count -gt 0 -and $visited -lt $scanLimit -and $clock.ElapsedMilliseconds -lt 6500) {
    $entry = $queue.Dequeue()
    $element = $entry[0]
    $depth = [int]$entry[1]
    $withinMatch = [bool]$entry[2]
    $container = [string]$entry[3]
    $visited++

    if ($element.Cached.IsPassword) { continue }
    $data = Describe $element
    if ($data) { $data.container = $container }
    $needle = [string]$request.query
    $matches = $data -and (-not $needle -or $withinMatch -or ($data.name + ' ' + $data.role + ' ' + $data.value).IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -ge 0)
    if ($request.operation -eq 'act' -and $data -and (($data.runtime -join ',') -eq ($request.expected.runtime -join ','))) {
      $found = $element; $description = $data; break
    }


    if ($request.operation -eq 'inspect' -and $data -and ($data.name -or $data.value -or $data.actions.Count)) {
      if ($matches) {
        if ($matched -ge $offset) { [void]$items.Add($data) }
        $matched++
        if ($items.Count -ge 50) { break }
      }
    }
    if ($depth -lt 24) {


      $group = $data -and $data.name -and $data.role -in @('Group', 'ToolBar', 'Menu')
      $childMatch = $withinMatch -or ($needle -and $matches -and $group)
      $childContainer = if ($group) { $data.name } else { $container }
      $child = $walker.GetFirstChild($element, $cache)
      while ($child -and ($queue.Count + $visited) -lt $scanLimit) {
        $queue.Enqueue(@($child, ($depth + 1), $childMatch, $childContainer))
        $child = $walker.GetNextSibling($child, $cache)
      }
      if ($child) { $limited = $true }
    } else { $limited = $true }
  }
  if ($request.operation -eq 'inspect') {
    $truncated = $limited -or $queue.Count -gt 0 -or $items.Count -ge 50 -or $visited -ge $scanLimit
    $reason = if ($truncated) { 'scan-limited' } elseif ($items.Count -eq 0 -and $request.query) { 'no-match' } elseif ($items.Count -eq 0) { 'no-controls' } else { 'available' }
    $result = @{ status = 'observed'; controls = @($items.ToArray()); truncated = $truncated; visited = $visited; scanLimit = $scanLimit; diagnostic = $reason }
  } elseif ($request.operation -eq 'act') {
    if (-not $found) { throw 'Control is no longer visible. Inspect the app again.' }
    # Traversal caches can precede dispatch by several seconds. Reacquire the
    # selected node's properties immediately before the mutation identity check.
    $found = $found.GetUpdatedCache($cache)
    $description = Describe $found
    if (-not $description) { throw 'Control is no longer available. Inspect again.' }
    foreach ($key in @('name', 'automationId', 'role', 'valueHash', 'selected', 'toggle', 'expanded', 'vertical')) {
      if ([string]$description[$key] -cne [string]$request.expected.$key) { throw 'Control changed since inspection. Inspect the app again.' }
    }
    if (($description.bounds -join ',') -ne ($request.expected.bounds -join ',')) { throw 'Control moved since inspection. Inspect the app again.' }
    if (-not $description.enabled -or $description.actions -notcontains $request.action) { throw 'This control does not support that action now.' }
    if ($root.Current.ProcessId -ne $request.pid -or $found.Current.IsPassword -or $found.Current.IsOffscreen) { throw 'Target is no longer available.' }
    $script:attempted = $true
    $verified = $false
    switch ([string]$request.action) {
      'set_value' {
        if ([string]$request.text -match '[\x00-\x08\x0b\x0c\x0e-\x1f]' -or ([string]$request.text).Length -gt 2000) { throw 'Invalid field text.' }
        $p = Pattern $found ([Windows.Automation.ValuePattern]::Pattern)
        if ($p.Current.IsReadOnly) { throw 'Field is read-only.' }
        $p.SetValue([string]$request.text)
        $verified = $p.Current.Value -ceq [string]$request.text
      }
      'invoke' { (Pattern $found ([Windows.Automation.InvokePattern]::Pattern)).Invoke() }
      'select' {
        $p = Pattern $found ([Windows.Automation.SelectionItemPattern]::Pattern)
        $p.Select(); $verified = $p.Current.IsSelected
      }
      'toggle' {
        $p = Pattern $found ([Windows.Automation.TogglePattern]::Pattern)
        $before = $p.Current.ToggleState
        $p.Toggle(); $verified = $p.Current.ToggleState -ne $before
      }
      'expand' {
        $p = Pattern $found ([Windows.Automation.ExpandCollapsePattern]::Pattern)
        $p.Expand(); $verified = $p.Current.ExpandCollapseState -eq 'Expanded'
      }
      'collapse' {
        $p = Pattern $found ([Windows.Automation.ExpandCollapsePattern]::Pattern)
        $p.Collapse(); $verified = $p.Current.ExpandCollapseState -eq 'Collapsed'
      }
      { $_ -in @('scroll_up', 'scroll_down') } {
        $p = Pattern $found ([Windows.Automation.ScrollPattern]::Pattern)
        $before = $p.Current.VerticalScrollPercent
        $amount = if ($request.action -eq 'scroll_up') { [Windows.Automation.ScrollAmount]::LargeDecrement } else { [Windows.Automation.ScrollAmount]::LargeIncrement }
        $p.Scroll([Windows.Automation.ScrollAmount]::NoAmount, $amount)
        $verified = $p.Current.VerticalScrollPercent -ne $before
      }
      default { throw 'Unsupported control action.' }
    }
    $status = if ($verified) { 'verified' } elseif ($request.action -eq 'invoke') { 'reported' } else { 'uncertain' }
    $result = @{ status = $status; message = 'Control operation returned. Inspect again for the next action or broader outcome.' }
  } else { throw 'Unsupported operation.' }
} catch {
  $status = if ($script:attempted) { 'uncertain' } else { 'failed' }
  $result = @{ status = $status; message = Short $_.Exception.Message }
}
$script:reply = $result
}
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $script:reply = @{ status = 'failed'; message = 'Invalid request.' }
  $id = $null
  try { $request = $line | ConvertFrom-Json; $id = $request.id; $null = Handle $request } catch { }
  $script:reply.id = $id
  [Console]::Out.WriteLine(($script:reply | ConvertTo-Json -Depth 12 -Compress))
  [Console]::Out.Flush()
}
