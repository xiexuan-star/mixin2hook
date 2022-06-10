const consola = require('consola');
const path = require('path');
const chalk = require('chalk');
const fs = require('fs/promises');

module.exports = async function (name, options) {
  const cwd = process.cwd();
  const { output, input } = options;
  if (!output || !input) {
    consola.error(chalk.red(`[M2H]: both output and input are ${chalk.bold('required')}`));
    return;
  }
  const inputPath = path.resolve(cwd, input);
  // 检查权限
  await fs.access(inputPath);
  const data = await fs.readFile(inputPath, 'utf-8');
  consola.log(data);
};
