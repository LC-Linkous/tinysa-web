// serial-link.js — Web Serial transport for ShellLink.
// SPDX-License-Identifier: GPL-2.0-only
import { ShellLink } from './shell-link.js';

// STM32 virtual COM port. The tinySA uses the same pair, so this only narrows
// the chooser; identification is by reply (see nanovna.js identify()).
export const USB_FILTER = [{ usbVendorId: 0x0483, usbProductId: 0x5740 }];

export const hasWebSerial = () => 'serial' in navigator;

export class SerialLink extends ShellLink {
  constructor() { super(); this.port = null; this.reader = null; this.writer = null; this.onDrop = null; }

  async open() {
    this.port = await navigator.serial.requestPort({ filters: USB_FILTER });
    await this.port.open({ baudRate: 115200 });
    this.writer = this.port.writable.getWriter();
    this._readLoop();
  }
  async _readLoop() {
    try {
      this.reader = this.port.readable.getReader();
      for (;;) { const { value, done } = await this.reader.read(); if (done) break; this._feed(value); }
    } catch (e) {
      if (!this.closed && this.onDrop) this.onDrop(e);
    }
  }
  _write(s) { return this.writer.write(this.enc.encode(s)); }
  /** Fire-and-forget write for page unload (no await possible). */
  writeSync(s) { try { this.writer.write(this.enc.encode(s)); } catch {} }
  info() {
    try { const i = this.port.getInfo(); return `usb ${i.usbVendorId?.toString(16)}:${i.usbProductId?.toString(16)}`; } catch { return 'n/a'; }
  }
  async close() {
    this.closed = true;
    try { if (this.reader) { await this.reader.cancel(); this.reader.releaseLock(); } } catch {}
    try { this.writer?.releaseLock(); } catch {}
    try { await this.port?.close(); } catch {}
  }
}
