# ArchDisc Studio — Third-Party Notices

ArchDisc Studio is licensed under the GNU General Public License, version 3
or later (GPL-3.0-or-later). Full license text is in `LICENSE`.

## Vendored components

### Blender — `blender/`

ArchDisc Studio incorporates source code from the **Blender** project
(<https://www.blender.org>), licensed under GPL-3.0-or-later. The full
Blender source as vendored at the time of import is located in `blender/`
at the root of this repository.

Blender © 1995–present, The Blender Foundation and the Blender
contributors. All rights reserved by their respective authors as recorded
in `blender/AUTHORS` and the Blender git history.

Because Studio embeds and links against Blender code, the entire Studio
codebase is distributed under GPL-3.0-or-later. The corresponding source
code is the contents of this repository; installer builds satisfy the GPL
source-distribution requirement by linking to the public Studio repository.

### Other components

Additional third-party components inherited from the ArchDisc shell remain
under their original upstream licenses (Electron, three.js, manifold-3d,
opencascade.js, React, Vite, etc.). Their license texts ship under each
respective `node_modules/<package>/LICENSE` in built installers and are
collected by `electron-builder` into the installer's license dialog.

## Attribution policy

Any redistribution of ArchDisc Studio binaries must include this NOTICE
file together with the GPL-3 LICENSE text and the corresponding source
(by repository pointer or full source archive).
