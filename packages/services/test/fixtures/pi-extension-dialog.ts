import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

export default function (pi: ExtensionAPI) {
  pi.registerCommand('pi-dialog-gate', {
    description: 'Test fail-closed RPC dialog without a timeout',
    handler: async (_args, ctx) => {
      const allowed = await ctx.ui.confirm('Allow side effect?', 'This must be denied without GUI consent');
      ctx.ui.notify(allowed ? 'UNSAFE_GRANTED' : 'SAFE_DENIED', allowed ? 'error' : 'info');
    },
  });
}
