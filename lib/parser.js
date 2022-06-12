import fs from 'fs';
import { Transformer } from './transformer.js';
import { Collector } from './collector.js';

function readFile(filePath) {
  return fs.readFileSync(filePath, { encoding: 'utf8' });
}

function parser(filePath) {
  const source = readFile(filePath);

  const collector = new Collector(source);
  collector.collect();

  const transformer = new Transformer(collector);
  transformer.transform();

  fs.writeFile('./example/output.ts', transformer.code, err => {
    //
  });
}

parser('./example/index.js');
