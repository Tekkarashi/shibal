/**
 * Browser preview only (`npm run web`). The phone app never loads this file.
 *
 * Lets the preview open screens that a phone reaches through a share
 * (e.g. the WhatsApp import), since a browser cannot receive shares.
 */
import { navRef } from './nav';

(window as unknown as { shibalNav: typeof navRef }).shibalNav = navRef;
