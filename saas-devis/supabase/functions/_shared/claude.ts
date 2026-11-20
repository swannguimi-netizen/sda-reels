import Anthropic from 'npm:@anthropic-ai/sdk@1.9.0'

/** Modèle utilisé pour toutes les fonctionnalités IA (modifiable par variable d'environnement). */
export const CLAUDE_MODEL = Deno.env.get('CLAUDE_MODEL') ?? 'claude-opus-5-5'

let client: Anthropic | null = null
export function claude(): Anthropic {
  if (!Deno.env.get('ANTHROPIC_API_KEY')) throw new Error('IA non configurée (ANTHROPIC_API_KEY manquante).')
  client ??= new Anthropic() // lit ANTHROPIC_API_KEY
  return client
}

export { Anthropic }
