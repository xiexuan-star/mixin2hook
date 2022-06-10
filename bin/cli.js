#! /usr/bin/env node
const program = require("commander");
const chalk = require("chalk");

program
  .command("start <hook-name>")
  .description("start a transform task")
  .option("-i,--input", "file path of mixin")
  .option("-o,--out", "output path of hook")
  .option("-f, --force", "overwrite target directory if it exist")
  .action((name, options) => {
    const { start } = require("../lib");
    start(name, options);
  });

program
  // 配置版本号信息
  .version(`v${require("../package.json").version}`)
  .usage("<command> [option]");

// 解析用户执行命令传入参数
program.parse(process.argv);
