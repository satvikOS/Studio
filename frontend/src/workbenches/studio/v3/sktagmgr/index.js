// Slice 715 — SketchUp Tag Manager.

import { registerOps } from '../common/registry.js';
import {
  createTag, deleteTag, assignToTag, setVisible, setLocked, setColor,
  listTags, getTagOf, isolateTag, showAll,
} from './tags.js';

let _installed = false;

export function installSKTagMgr() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioSKTagCreate: createTag,
    __studioSKTagDelete: deleteTag,
    __studioSKTagAssign: assignToTag,
    __studioSKTagSetVisible: setVisible,
    __studioSKTagSetLocked: setLocked,
    __studioSKTagSetColor: setColor,
    __studioSKTagList: listTags,
    __studioSKTagGetTagOf: getTagOf,
    __studioSKTagIsolate: isolateTag,
    __studioSKTagShowAll: showAll,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'arch', 'SketchUp Tag Manager — assign / hide / isolate / lock / recolor');
}
