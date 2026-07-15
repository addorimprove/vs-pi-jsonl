import Mocha from 'mocha';

export function run(): Promise<void> {
  const mocha = new Mocha({ color: true, ui: 'tdd', timeout: 30_000 });
  mocha.addFile(require.resolve('./open-with.test.js'));
  mocha.addFile(require.resolve('./custom-editor.integration.test.js'));
  return new Promise((resolve, reject) => {
    mocha.run((failures) => {
      if (failures === 0) {
        resolve();
      } else {
        reject(new Error(`${failures} VS Code extension-host test(s) failed.`));
      }
    });
  });
}
