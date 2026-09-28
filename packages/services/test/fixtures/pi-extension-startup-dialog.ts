import { writeFile } from 'node:fs/promises';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

export default function (pi: ExtensionAPI) {
  pi.on('session_start', async (_event, ctx) => {
    const allowed = await ctx.ui.confirm('Startup gate', 'Never implicitly authorize');
    if (allowed && process.env.PI_BOOTSTRAP_ALLOW_MARKER) {
      await writeFile(process.env.PI_BOOTSTRAP_ALLOW_MARKER, 'unexpected approval');
    }
  });
}
