import { createHash } from 'crypto'
import type { PluginSkill } from '../../shared/plugins'

export function pluginSkillId(plugin: string, path: string): string {
  return `plugin/${plugin}/${createHash('sha256').update(path).digest('hex').slice(0, 32)}`
}

export function pluginSkills(plugin: string, documents: Record<string, string>): PluginSkill[] {
  return Object.entries(documents)
    .filter(([path]) => /(?:^|\/)SKILL\.md$/i.test(path))
    .map(([path, content]) => {
      const header = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] ?? ''

      const field = (name: string): string => {
        const match = header.match(
          new RegExp(`^${name}:\\s*([^\\r\\n]*)(?:\\r?\\n((?:[ \\t]+[^\\r\\n]*\\r?\\n?)*))?`, 'm')
        )
        if (!match) return ''
        const text = /^[>|][-+]?\s*$/.test(match[1]) ? (match[2] ?? '') : match[1]
        return text
          .trim()
          .replace(/^["']|["']$/g, '')
          .replace(/\s+/g, ' ')
      }
      return {
        id: pluginSkillId(plugin, path),
        path,
        name: (field('name') || path.split('/').at(-2) || 'Skill').slice(0, 100),
        description: (
          field('description') ||
          content.match(/^#\s+(.+)$/m)?.[1] ||
          'Read this skill for its applicability and instructions.'
        ).slice(0, 400)
      }
    })
}
