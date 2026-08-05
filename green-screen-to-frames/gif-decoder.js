(() => {
  async function decodeGifFrames(buffer, onFrame) {
    const reader = new GifReader(new Uint8Array(buffer));
    const signature = reader.readString(6);
    if (signature !== "GIF87a" && signature !== "GIF89a") {
      throw new Error("不是有效 GIF 文件。");
    }

    const width = reader.readUint16();
    const height = reader.readUint16();
    if (!width || !height) throw new Error("GIF 尺寸无效。");

    const packed = reader.readByte();
    const hasGlobalColorTable = (packed & 0x80) !== 0;
    const globalColorTableSize = 1 << ((packed & 0x07) + 1);
    const backgroundIndex = reader.readByte();
    reader.readByte();

    const globalColorTable = hasGlobalColorTable ? reader.readColorTable(globalColorTableSize) : null;
    const canvasData = new Uint8ClampedArray(width * height * 4);
    const backgroundColor = globalColorTable ? globalColorTable[backgroundIndex] : null;
    let graphicControl = defaultGraphicControl();
    let pendingDisposal = null;
    let frameIndex = 0;

    while (!reader.eof()) {
      const block = reader.readByte();
      if (block === 0x3b) break;

      if (block === 0x21) {
        const label = reader.readByte();
        if (label === 0xf9) {
          const blockSize = reader.readByte();
          const gcePacked = reader.readByte();
          const delay = reader.readUint16();
          const transparentIndex = reader.readByte();
          reader.readByte();
          if (blockSize !== 4) reader.skip(blockSize - 4);
          graphicControl = {
            disposal: (gcePacked >> 2) & 0x07,
            transparentIndex: (gcePacked & 0x01) !== 0 ? transparentIndex : null,
            delayMs: Math.max(16, delay ? delay * 10 : 100),
          };
        } else {
          reader.readSubBlocks();
        }
        continue;
      }

      if (block !== 0x2c) {
        throw new Error(`无法解析 GIF block: 0x${block.toString(16)}`);
      }

      if (pendingDisposal) {
        applyDisposal(canvasData, width, pendingDisposal, backgroundColor);
        pendingDisposal = null;
      }

      const left = reader.readUint16();
      const top = reader.readUint16();
      const frameWidth = reader.readUint16();
      const frameHeight = reader.readUint16();
      const imagePacked = reader.readByte();
      const hasLocalColorTable = (imagePacked & 0x80) !== 0;
      const interlaced = (imagePacked & 0x40) !== 0;
      const localColorTableSize = 1 << ((imagePacked & 0x07) + 1);
      const colorTable = hasLocalColorTable ? reader.readColorTable(localColorTableSize) : globalColorTable;
      if (!colorTable) throw new Error("GIF 缺少颜色表。");

      const minCodeSize = reader.readByte();
      const compressed = reader.readSubBlocks();
      const pixels = lzwDecode(minCodeSize, compressed, frameWidth * frameHeight);
      const restore = graphicControl.disposal === 3
        ? copyArea(canvasData, width, left, top, frameWidth, frameHeight)
        : null;

      drawIndexedFrame({
        canvasData,
        canvasWidth: width,
        canvasHeight: height,
        pixels,
        colorTable,
        left,
        top,
        frameWidth,
        frameHeight,
        interlaced,
        transparentIndex: graphicControl.transparentIndex,
      });

      const shouldContinue = await onFrame({
        data: canvasData,
        width,
        height,
        delayMs: graphicControl.delayMs,
        index: frameIndex,
      });
      if (shouldContinue === false) return;

      pendingDisposal = {
        disposal: graphicControl.disposal,
        left,
        top,
        width: frameWidth,
        height: frameHeight,
        restore,
      };
      graphicControl = defaultGraphicControl();
      frameIndex += 1;
    }
  }

  function defaultGraphicControl() {
    return { disposal: 0, transparentIndex: null, delayMs: 100 };
  }

  class GifReader {
    constructor(bytes) {
      this.bytes = bytes;
      this.offset = 0;
    }

    eof() {
      return this.offset >= this.bytes.length;
    }

    readByte() {
      if (this.offset >= this.bytes.length) throw new Error("GIF 数据提前结束。");
      return this.bytes[this.offset++];
    }

    readUint16() {
      const first = this.readByte();
      const second = this.readByte();
      return first | (second << 8);
    }

    readString(length) {
      let value = "";
      for (let index = 0; index < length; index += 1) value += String.fromCharCode(this.readByte());
      return value;
    }

    readColorTable(size) {
      const table = new Array(size);
      for (let index = 0; index < size; index += 1) {
        table[index] = [this.readByte(), this.readByte(), this.readByte()];
      }
      return table;
    }

    readSubBlocks() {
      const chunks = [];
      let total = 0;
      while (true) {
        const size = this.readByte();
        if (size === 0) break;
        if (this.offset + size > this.bytes.length) throw new Error("GIF 数据提前结束。");
        const chunk = this.bytes.slice(this.offset, this.offset + size);
        chunks.push(chunk);
        total += size;
        this.offset += size;
      }
      const output = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.length;
      }
      return output;
    }

    skip(count) {
      if (count < 0 || this.offset + count > this.bytes.length) throw new Error("GIF 数据提前结束。");
      this.offset += count;
    }
  }

  function lzwDecode(minCodeSize, data, expectedLength) {
    const maxStackSize = 4096;
    const output = new Uint8Array(expectedLength);
    const prefix = new Int16Array(maxStackSize);
    const suffix = new Uint8Array(maxStackSize);
    const pixelStack = new Uint8Array(maxStackSize + 1);
    const clear = 1 << minCodeSize;
    const endOfInformation = clear + 1;
    let available = clear + 2;
    let oldCode = -1;
    let codeSize = minCodeSize + 1;
    let codeMask = (1 << codeSize) - 1;

    for (let code = 0; code < clear; code += 1) suffix[code] = code;

    let datum = 0;
    let bits = 0;
    let first = 0;
    let stackTop = 0;
    let outputIndex = 0;
    let byteIndex = 0;

    while (outputIndex < expectedLength) {
      if (stackTop === 0) {
        if (bits < codeSize) {
          if (byteIndex >= data.length) break;
          datum += data[byteIndex] << bits;
          bits += 8;
          byteIndex += 1;
          continue;
        }

        let code = datum & codeMask;
        datum >>= codeSize;
        bits -= codeSize;
        if (code > available || code === endOfInformation) break;

        if (code === clear) {
          codeSize = minCodeSize + 1;
          codeMask = (1 << codeSize) - 1;
          available = clear + 2;
          oldCode = -1;
          continue;
        }

        if (oldCode === -1) {
          pixelStack[stackTop++] = suffix[code];
          oldCode = code;
          first = code;
          continue;
        }

        const inputCode = code;
        if (code === available) {
          pixelStack[stackTop++] = first;
          code = oldCode;
        }

        while (code > clear) {
          pixelStack[stackTop++] = suffix[code];
          code = prefix[code];
        }

        first = suffix[code];
        pixelStack[stackTop++] = first;

        if (available < maxStackSize) {
          prefix[available] = oldCode;
          suffix[available] = first;
          available += 1;
          if ((available & codeMask) === 0 && available < maxStackSize) {
            codeSize += 1;
            codeMask += available;
          }
        }
        oldCode = inputCode;
      }

      output[outputIndex++] = pixelStack[--stackTop];
    }

    return output;
  }

  function drawIndexedFrame(options) {
    const rows = options.interlaced
      ? interlaceRows(options.frameHeight)
      : Array.from({ length: options.frameHeight }, (_, row) => row);
    let pixelOffset = 0;

    for (const row of rows) {
      const y = options.top + row;
      for (let x = 0; x < options.frameWidth; x += 1) {
        const index = options.pixels[pixelOffset++];
        if (index === options.transparentIndex) continue;
        const targetX = options.left + x;
        if (targetX < 0 || targetX >= options.canvasWidth || y < 0 || y >= options.canvasHeight) continue;

        const color = options.colorTable[index] || [0, 0, 0];
        const output = (y * options.canvasWidth + targetX) * 4;
        options.canvasData[output] = color[0];
        options.canvasData[output + 1] = color[1];
        options.canvasData[output + 2] = color[2];
        options.canvasData[output + 3] = 255;
      }
    }
  }

  function interlaceRows(height) {
    const rows = [];
    for (let y = 0; y < height; y += 8) rows.push(y);
    for (let y = 4; y < height; y += 8) rows.push(y);
    for (let y = 2; y < height; y += 4) rows.push(y);
    for (let y = 1; y < height; y += 2) rows.push(y);
    return rows;
  }

  function copyArea(data, canvasWidth, left, top, width, height) {
    const copy = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      const sourceStart = ((top + y) * canvasWidth + left) * 4;
      copy.set(data.slice(sourceStart, sourceStart + width * 4), y * width * 4);
    }
    return copy;
  }

  function applyDisposal(data, canvasWidth, disposalInfo, backgroundColor) {
    if (disposalInfo.disposal === 2) {
      for (let y = 0; y < disposalInfo.height; y += 1) {
        for (let x = 0; x < disposalInfo.width; x += 1) {
          const output = ((disposalInfo.top + y) * canvasWidth + disposalInfo.left + x) * 4;
          data[output] = backgroundColor?.[0] || 0;
          data[output + 1] = backgroundColor?.[1] || 0;
          data[output + 2] = backgroundColor?.[2] || 0;
          data[output + 3] = 0;
        }
      }
    } else if (disposalInfo.disposal === 3 && disposalInfo.restore) {
      for (let y = 0; y < disposalInfo.height; y += 1) {
        const destination = ((disposalInfo.top + y) * canvasWidth + disposalInfo.left) * 4;
        const source = y * disposalInfo.width * 4;
        data.set(disposalInfo.restore.slice(source, source + disposalInfo.width * 4), destination);
      }
    }
  }

  window.decodeGifFrames = decodeGifFrames;
})();
