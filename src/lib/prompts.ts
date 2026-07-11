import { checkbox } from '@inquirer/prompts'
import { PROVIDER_REGISTRY } from './provider-registry'

/** Prompt the User to pick which providers to activate the selection for. */
export async function promptProviders(): Promise<string[]> {
  return checkbox({
    message: 'Select providers to add:',
    choices: Object.keys(PROVIDER_REGISTRY).map(provider => ({ value: provider, name: provider })),
  })
}
