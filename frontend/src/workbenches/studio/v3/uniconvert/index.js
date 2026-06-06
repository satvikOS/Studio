// Slice 712 — Universal mesh format parsers.

import { registerOps } from '../common/registry.js';
import {
  parseSTL, parseSTLBinary, parsePLY, parseOFF, parse3MF,
  importParsed, importFile,
} from './parsers.js';

let _installed = false;

export function installUniConvert() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioUniConvertParseSTL: parseSTL,
    __studioUniConvertParseSTLBinary: parseSTLBinary,
    __studioUniConvertParsePLY: parsePLY,
    __studioUniConvertParseOFF: parseOFF,
    __studioUniConvertParse3MF: parse3MF,
    __studioUniConvertImportParsed: importParsed,
    __studioUniConvertImportFile: importFile,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'assetbrowser', 'Universal mesh import — STL / PLY / OFF / 3MF');
}
