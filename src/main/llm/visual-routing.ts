export function needsVisualTools(text: string): boolean {
  const request = text
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, '')

    .replace(
      /\b(?:do not|don't|never)\s+(?:save|export|write|create|open|use)\s+(?:(?:any|a|the|new)\s+)*(?:files?|folders?|browser|desktop)\b/gi,
      ''
    )
  return [
    /\b(?:set_volume|list_audio|set_radio|list_radios)\b|\b(?:set|adjust|raise|lower|increase|decrease|enable|disable|turn on|turn off)\b[^.!?\n]{0,50}\b(?:volume|wi-?fi|bluetooth)\b|^(?:(?:please|can you|could you)\s+)*(?:mute|unmute)\s+\S/i,
    /https:\/\/|\b(?:web_search|web_fetch|search|research|browse|online|latest|current data|sources?|citations?)\b/i,
    /\b(?:inspect_app|act_on_control)\b|\b(?:fill|enter|replace|type|click|select|toggle|expand|collapse)\b[^.!?\n]{0,60}\b(?:field|textbox|input|button|checkbox|control|notepad|app)\b/i,
    /^(?:(?:please|can you|could you|would you)\s+)*(?:open|launch|close|focus|switch to|save|export)\s+\S/i,
    /\b(?:on|at|from|of|inspect|capture|view|read|see)\s+(?:(?:my|the|this|current|active|visible)\s+)*(?:screen|desktop|monitor|window)\b/i,
    /\b(?:take|capture|grab)\s+(?:(?:a|the|another|new)\s+)*(?:screenshot|screen ?shot)\b/i,
    /\b(?:open|launch|close|focus|minimi[sz]e|maximi[sz]e|resize|move|switch to)\s+(?:(?:my|the|this|a|an)\s+)?(?:app|window|browser|chrome|edge|firefox|notepad|excel|powershell|terminal)\b/i,
    /\b(?:read|load|inspect|browse|list|save|export|write|create|update|edit|modify|open|use)\b[^.!?\n]{0,80}\b(?:files?|folders?|directory|workspace|csv|pdf|spreadsheet|workbook)\b/i,
    /\b(?:from|in|using|based on)\s+(?:(?:my|the|this|a|an)\s+)*(?:files?|folders?|workspace|csv|pdf|spreadsheet|workbook)\b/i,
    /\b[\w.-]+\.(?:csv|xlsx?|pdf|json|txt|html|svg|png|jpe?g)\b|[A-Z]:\\|\b(?:look_at_screen|read_file|write_file|open_app|list_files)\b/i,
    /\b(?:click|scroll|type|press)\b[^.!?\n]{0,50}\b(?:screen|desktop|window|browser|keyboard)\b/i,
    /\b(?:mon|ton|cet|l['’])\s*(?:[ée]cran|bureau)|\b(?:fichier|dossier)\b|\b(?:bildschirm|datei|ordner)\b/i
  ].some((pattern) => pattern.test(request))
}

export const INLINE_VISUAL_TASK =
  'CURRENT TURN: Generate a self-contained inline visual from the conversation. Desktop and file tools are disabled for this turn. Do not capture or inspect the screen, open a browser, or create files. "Show me" and "render inline" mean write the visual in your answer. Earlier screenshot/tool results do not change this task. Return complete fenced HTML, SVG or Mermaid using the installed visual capabilities.'
