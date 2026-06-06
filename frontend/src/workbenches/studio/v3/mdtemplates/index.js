// Slice 710 — Marvelous Designer pre-built clothing templates.

import { registerOps } from '../common/registry.js';
import {
  tShirt, longSleeveShirt, pants, dress, skirt, hoodie, vest, shorts,
} from './templates.js';

let _installed = false;

export function installMDTemplates() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioMDTplTShirt: tShirt,
    __studioMDTplLongSleeveShirt: longSleeveShirt,
    __studioMDTplPants: pants,
    __studioMDTplDress: dress,
    __studioMDTplSkirt: skirt,
    __studioMDTplHoodie: hoodie,
    __studioMDTplVest: vest,
    __studioMDTplShorts: shorts,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'sim', 'Marvelous Designer clothing templates: t-shirt / pants / dress / skirt / hoodie / vest / shorts');
}
