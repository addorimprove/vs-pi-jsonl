import { runTests } from '@vscode/test-electron';
import { resolve } from 'node:path';

async function main(): Promise<void> {
  const root = resolve(process.cwd());
  await runTests({
    version: process.env.VSCODE_VERSION ?? '1.127.0',
    extensionDevelopmentPath: root,
    extensionTestsPath: resolve(root, 'dist/test/vscode/suite/index.js'),
    launchArgs: [
      resolve(root, 'src/test/fixtures/vscode'),
      '--disable-extensions',
      '--disable-gpu',
      '--no-sandbox'
    ]
  });
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
