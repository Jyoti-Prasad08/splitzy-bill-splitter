/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * SPLITZY — Financial Calculation Engine & Interactive Architecture
 * Pure Vanilla JavaScript (ES6+)
 */

(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // 1. Color Palettes & Constants
  // ---------------------------------------------------------------------------
  const AVATAR_PALETTE = [
    '#8B5CF6', '#06B6D4', '#10B981', '#F59E0B', 
    '#EC4899', '#3B82F6', '#14B8A6', '#6366F1', 
    '#D946EF', '#84CC16', '#F43F5E', '#0EA5E9'
  ];

  const MAX_SUPPORTED_PEOPLE = 50;
  const HISTORY_STORAGE_KEY = 'splitzy_history_records';
  const THEME_STORAGE_KEY = 'splitzy_user_theme';
  const RECIPIENT_UPI_KEY = 'splitzy_recipient_upi';
  const RECIPIENT_NAME_KEY = 'splitzy_recipient_name';

  // ---------------------------------------------------------------------------
  // 1.5. Native Dependency-Free QR Code Generator (Model 2, Byte Mode)
  // ---------------------------------------------------------------------------
  const QRCode = (() => {
    const EXP_TABLE = new Uint8Array(256);
    const LOG_TABLE = new Uint8Array(256);
    for (let i = 0, x = 1; i < 256; i++) {
      EXP_TABLE[i] = x;
      LOG_TABLE[x] = i;
      x = (x << 1) ^ (x >= 128 ? 0x11d : 0);
    }

    function gfMul(x, y) {
      if (x === 0 || y === 0) return 0;
      return EXP_TABLE[(LOG_TABLE[x] + LOG_TABLE[y]) % 255];
    }

    const CAPACITY_TABLE_M = [
      null,
      { version: 1, total: 26, ec: 10, blocks: [[1, 16]] },
      { version: 2, total: 44, ec: 16, blocks: [[1, 28]] },
      { version: 3, total: 70, ec: 26, blocks: [[1, 44]] },
      { version: 4, total: 100, ec: 18, blocks: [[2, 32]] },
      { version: 5, total: 134, ec: 24, blocks: [[2, 43]] },
      { version: 6, total: 172, ec: 16, blocks: [[4, 27]] },
      { version: 7, total: 196, ec: 18, blocks: [[4, 31]] },
      { version: 8, total: 242, ec: 22, blocks: [[2, 38], [2, 39]] },
      { version: 9, total: 292, ec: 22, blocks: [[3, 36], [2, 37]] },
      { version: 10, total: 346, ec: 26, blocks: [[4, 43], [1, 44]] }
    ];

    const CAPACITY_TABLE_L = [
      null,
      { version: 1, total: 26, ec: 7, blocks: [[1, 19]] },
      { version: 2, total: 44, ec: 10, blocks: [[1, 34]] },
      { version: 3, total: 70, ec: 15, blocks: [[1, 55]] },
      { version: 4, total: 100, ec: 20, blocks: [[1, 80]] },
      { version: 5, total: 134, ec: 26, blocks: [[1, 108]] },
      { version: 6, total: 172, ec: 18, blocks: [[2, 68]] },
      { version: 7, total: 196, ec: 20, blocks: [[2, 78]] },
      { version: 8, total: 242, ec: 24, blocks: [[2, 97]] },
      { version: 9, total: 292, ec: 30, blocks: [[2, 116]] },
      { version: 10, total: 346, ec: 18, blocks: [[2, 68], [2, 69]] }
    ];

    function rsGeneratorPoly(degree) {
      let poly = [1];
      for (let i = 0; i < degree; i++) {
        const next = new Array(poly.length + 1).fill(0);
        const factor = EXP_TABLE[i];
        for (let j = 0; j < poly.length; j++) {
          next[j] ^= poly[j];
          next[j + 1] ^= gfMul(poly[j], factor);
        }
        poly = next;
      }
      return poly;
    }

    function calculateEC(data, ecCount) {
      const gen = rsGeneratorPoly(ecCount);
      const result = new Array(ecCount).fill(0);
      for (let i = 0; i < data.length; i++) {
        const factor = data[i] ^ result[0];
        result.shift();
        result.push(0);
        for (let j = 0; j < ecCount; j++) {
          result[j] ^= gfMul(gen[j + 1], factor);
        }
      }
      return result;
    }

    const ALIGNMENT_PATTERN_LOCATIONS = [
      [],
      [],
      [6, 18],
      [6, 22],
      [6, 26],
      [6, 30],
      [6, 34],
      [6, 22, 38],
      [6, 24, 42],
      [6, 26, 46],
      [6, 28, 50]
    ];

    function getVersionForLength(dataLen, ecLevel = 'M') {
      const table = ecLevel === 'M' ? CAPACITY_TABLE_M : CAPACITY_TABLE_L;
      for (let v = 1; v <= 10; v++) {
        const entry = table[v];
        let totalData = 0;
        entry.blocks.forEach(([num, len]) => {
          totalData += num * len;
        });
        const headerBits = v < 10 ? 12 : 20;
        const maxDataBytes = Math.floor((totalData * 8 - headerBits) / 8);
        if (dataLen <= maxDataBytes) {
          return { version: v, config: entry, ecLevel };
        }
      }
      if (ecLevel === 'M') return getVersionForLength(dataLen, 'L');
      throw new Error('Data too long for QR generator');
    }

    function createBitBuffer() {
      let buffer = [];
      let length = 0;
      return {
        put(num, bitLength) {
          for (let i = bitLength - 1; i >= 0; i--) {
            buffer.push((num >>> i) & 1);
            length++;
          }
        },
        getBuffer() { return buffer; },
        getLength() { return length; }
      };
    }

    function encodeData(text, version) {
      const bits = createBitBuffer();
      bits.put(0b0100, 4); // 8-bit Byte mode
      const charCountBits = version < 10 ? 8 : 16;
      const utf8Bytes = [];
      for (let i = 0; i < text.length; i++) {
        let code = text.charCodeAt(i);
        if (code < 0x80) {
          utf8Bytes.push(code);
        } else if (code < 0x800) {
          utf8Bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
        } else if (code < 0xd800 || code >= 0xe000) {
          utf8Bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
        } else {
          i++;
          code = 0x10000 + (((code & 0x3ff) << 10) | (text.charCodeAt(i) & 0x3ff));
          utf8Bytes.push(
            0xf0 | (code >> 18),
            0x80 | ((code >> 12) & 0x3f),
            0x80 | ((code >> 6) & 0x3f),
            0x80 | (code & 0x3f)
          );
        }
      }
      bits.put(utf8Bytes.length, charCountBits);
      utf8Bytes.forEach(b => bits.put(b, 8));
      return { bits, utf8Bytes };
    }

    function generateMatrix(text, preferredEC = 'M') {
      const { version, config, ecLevel } = getVersionForLength(text.length, preferredEC);
      const size = version * 4 + 17;
      const matrix = Array.from({ length: size }, () => Array(size).fill(null));
      const isReserved = Array.from({ length: size }, () => Array(size).fill(false));

      function setModule(r, c, val, reserved = true) {
        if (r >= 0 && r < size && c >= 0 && c < size) {
          matrix[r][c] = val ? 1 : 0;
          if (reserved) isReserved[r][c] = true;
        }
      }

      function addFinder(top, left) {
        for (let r = -1; r <= 7; r++) {
          for (let c = -1; c <= 7; c++) {
            const row = top + r;
            const col = left + c;
            if (row < 0 || row >= size || col < 0 || col >= size) continue;
            if (r >= 0 && r <= 6 && c >= 0 && c <= 6) {
              const isDark = (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
              setModule(row, col, isDark);
            } else {
              setModule(row, col, false);
            }
          }
        }
      }
      addFinder(0, 0);
      addFinder(0, size - 7);
      addFinder(size - 7, 0);

      const alignCoords = ALIGNMENT_PATTERN_LOCATIONS[version] || [];
      alignCoords.forEach(r => {
        alignCoords.forEach(c => {
          if (isReserved[r][c]) return;
          for (let dr = -2; dr <= 2; dr++) {
            for (let dc = -2; dc <= 2; dc++) {
              const isDark = (Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0));
              setModule(r + dr, c + dc, isDark);
            }
          }
        });
      });

      for (let i = 8; i < size - 8; i++) {
        if (!isReserved[6][i]) setModule(6, i, i % 2 === 0);
        if (!isReserved[i][6]) setModule(i, 6, i % 2 === 0);
      }

      setModule(size - 8, 8, true);

      for (let i = 0; i < 9; i++) {
        if (!isReserved[8][i]) isReserved[8][i] = true;
        if (!isReserved[i][8]) isReserved[i][8] = true;
      }
      for (let i = size - 8; i < size; i++) {
        if (!isReserved[8][i]) isReserved[8][i] = true;
        if (!isReserved[i][8]) isReserved[i][8] = true;
      }

      const { bits } = encodeData(text, version);
      let totalDataCodewords = 0;
      config.blocks.forEach(([num, len]) => {
        totalDataCodewords += num * len;
      });

      const totalDataBits = totalDataCodewords * 8;
      const remainingBits = totalDataBits - bits.getLength();
      bits.put(0, Math.min(4, Math.max(0, remainingBits)));

      while (bits.getLength() % 8 !== 0) {
        bits.put(0, 1);
      }

      const padBytes = [0xec, 0x11];
      let padIndex = 0;
      while (bits.getLength() < totalDataBits) {
        bits.put(padBytes[padIndex % 2], 8);
        padIndex++;
      }

      const bitArr = bits.getBuffer();
      const dataBytes = [];
      for (let i = 0; i < bitArr.length; i += 8) {
        let b = 0;
        for (let j = 0; j < 8; j++) {
          b = (b << 1) | bitArr[i + j];
        }
        dataBytes.push(b);
      }

      const dataBlocks = [];
      const ecBlocks = [];
      let byteOffset = 0;
      config.blocks.forEach(([numBlocks, dataPerBlock]) => {
        for (let b = 0; b < numBlocks; b++) {
          const blockData = dataBytes.slice(byteOffset, byteOffset + dataPerBlock);
          byteOffset += dataPerBlock;
          dataBlocks.push(blockData);
          ecBlocks.push(calculateEC(blockData, config.ec));
        }
      });

      const finalCodewords = [];
      const maxDataLen = Math.max(...dataBlocks.map(b => b.length));
      for (let i = 0; i < maxDataLen; i++) {
        dataBlocks.forEach(block => {
          if (i < block.length) finalCodewords.push(block[i]);
        });
      }
      for (let i = 0; i < config.ec; i++) {
        ecBlocks.forEach(block => {
          if (i < block.length) finalCodewords.push(block[i]);
        });
      }

      const dataBits = [];
      finalCodewords.forEach(cw => {
        for (let i = 7; i >= 0; i--) {
          dataBits.push((cw >>> i) & 1);
        }
      });

      const REMAINDER_BITS = [0, 0, 7, 7, 7, 7, 7, 0, 0, 0, 0];
      const remCount = REMAINDER_BITS[version] || 0;
      for (let i = 0; i < remCount; i++) dataBits.push(0);

      let bitIdx = 0;
      let upwards = true;
      for (let col = size - 1; col > 0; col -= 2) {
        if (col === 6) col--;
        const rows = [];
        if (upwards) {
          for (let r = size - 1; r >= 0; r--) rows.push(r);
        } else {
          for (let r = 0; r < size; r++) rows.push(r);
        }
        upwards = !upwards;

        rows.forEach(r => {
          [col, col - 1].forEach(c => {
            if (!isReserved[r][c]) {
              matrix[r][c] = bitIdx < dataBits.length ? dataBits[bitIdx++] : 0;
            }
          });
        });
      }

      const maskFn = (r, c) => (r + c) % 2 === 0;
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          if (!isReserved[r][c]) {
            if (maskFn(r, c)) {
              matrix[r][c] ^= 1;
            }
          }
        }
      }

      const formatBits = ecLevel === 'M' ? 0x5412 : 0x77c4;
      for (let i = 0; i < 15; i++) {
        const bit = (formatBits >>> (14 - i)) & 1;
        if (i < 6) {
          setModule(8, i, bit);
        } else if (i === 6) {
          setModule(8, 7, bit);
        } else if (i === 7) {
          setModule(8, 8, bit);
        } else if (i === 8) {
          setModule(7, 8, bit);
        } else {
          setModule(14 - i, 8, bit);
        }

        if (i < 8) {
          setModule(size - 1 - i, 8, bit);
        } else {
          setModule(8, size - 15 + i, bit);
        }
      }

      return { size, matrix };
    }

    return {
      generateMatrix,
      drawToCanvas(text, canvas, options = {}) {
        if (!canvas) return;
        const { size, matrix } = generateMatrix(text, options.ecLevel || 'M');
        const margin = options.margin !== undefined ? options.margin : 4;
        const totalModules = size + margin * 2;
        const targetSize = options.size || 220;
        const moduleSize = Math.max(1, Math.floor(targetSize / totalModules));
        const canvasDim = moduleSize * totalModules;

        canvas.width = canvasDim;
        canvas.height = canvasDim;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvasDim, canvasDim);

        ctx.fillStyle = '#0F172A';
        for (let r = 0; r < size; r++) {
          for (let c = 0; c < size; c++) {
            if (matrix[r][c] === 1) {
              ctx.fillRect((c + margin) * moduleSize, (r + margin) * moduleSize, moduleSize, moduleSize);
            }
          }
        }
        return canvas;
      }
    };
  })();

  // ---------------------------------------------------------------------------
  // 2. Application State (Transient - Cleared on Reload)
  // ---------------------------------------------------------------------------
  const state = {
    viewState: 'configuration', // 'configuration' | 'results'
    mode: 'equal', // 'equal' | 'custom'
    activeCalculation: null, // Holds current calculated split object
    customParticipants: [], // In custom mode: [{ id, name, amountPaise }]
    currentTheme: 'dark',
    selectedPayerId: null, // Currently active participant for UPI payment
    paidParticipants: new Set(), // Participant IDs confirmed paid by user
    recipientUpi: '',
    recipientName: ''
  };

  // ---------------------------------------------------------------------------
  // 3. DOM Elements Cache
  // ---------------------------------------------------------------------------
  let el = {};

  function cacheDom() {
    el = {
      // Workspace container & view-state cards
      workspaceContainer: document.getElementById('workspaceContainer'),
      workspaceGrid: document.getElementById('workspaceGrid'),
      formCard: document.getElementById('formCard'),
      resultsCard: document.getElementById('resultsCard'),
      resultsEditBtn: document.getElementById('resultsEditBtn'),
      resultsResetTopBtn: document.getElementById('resultsResetTopBtn'),
      resultsResetBtn: document.getElementById('resultsResetBtn'),

      // Nav & Controls
      themeToggleBtn: document.getElementById('themeToggleBtn'),
      themeIcon: document.getElementById('themeIcon'),
      historyToggleBtn: document.getElementById('historyToggleBtn'),

      // Form
      billForm: document.getElementById('billForm'),
      occasionInput: document.getElementById('occasionInput'),
      billAmountInput: document.getElementById('billAmountInput'),
      peopleCountInput: document.getElementById('peopleCountInput'),
      decreasePeopleBtn: document.getElementById('decreasePeopleBtn'),
      increasePeopleBtn: document.getElementById('increasePeopleBtn'),
      quickChips: document.querySelectorAll('.chip-btn'),
      splitModeBtns: document.querySelectorAll('.segmented-btn'),
      customSplitSection: document.getElementById('customSplitSection'),
      customParticipantsList: document.getElementById('customParticipantsList'),
      unallocatedBadge: document.getElementById('unallocatedBadge'),
      distributeRemainingBtn: document.getElementById('distributeRemainingBtn'),
      validationAlert: document.getElementById('validationAlert'),
      alertMessage: document.getElementById('alertMessage'),
      splitBtn: document.getElementById('splitBtn'),
      resetBtn: document.getElementById('resetBtn'),

      // Results Panel
      emptyState: document.getElementById('emptyState'),
      resultsDashboard: document.getElementById('resultsDashboard'),
      resultOccasion: document.getElementById('resultOccasion'),
      resultDate: document.getElementById('resultDate'),
      resultHeroAmount: document.getElementById('resultHeroAmount'),
      resultHeroSubtext: document.getElementById('resultHeroSubtext'),
      resultTotalBill: document.getElementById('resultTotalBill'),
      donutChartSvg: document.getElementById('donutChartSvg'),
      chartCenterTotal: document.getElementById('chartCenterTotal'),
      chartCenterCount: document.getElementById('chartCenterCount'),
      participantsGrid: document.getElementById('participantsGrid'),

      // UPI Payment & Settlement Section
      paymentSection: document.getElementById('paymentSection'),
      toggleRecipientConfigBtn: document.getElementById('toggleRecipientConfigBtn'),
      recipientStatusText: document.getElementById('recipientStatusText'),
      recipientConfigDrawer: document.getElementById('recipientConfigDrawer'),
      recipientNameInput: document.getElementById('recipientNameInput'),
      recipientUpiInput: document.getElementById('recipientUpiInput'),
      upiValidationIcon: document.getElementById('upiValidationIcon'),
      upiValidationMsg: document.getElementById('upiValidationMsg'),
      saveRecipientBtn: document.getElementById('saveRecipientBtn'),
      cancelRecipientBtn: document.getElementById('cancelRecipientBtn'),
      missingRecipientAlert: document.getElementById('missingRecipientAlert'),
      setupRecipientPromptBtn: document.getElementById('setupRecipientPromptBtn'),
      paymentActiveCard: document.getElementById('paymentActiveCard'),
      payerSelect: document.getElementById('payerSelect'),
      payerChips: document.getElementById('payerChips'),
      payerAvatarBadge: document.getElementById('payerAvatarBadge'),
      payerNameDisplay: document.getElementById('payerNameDisplay'),
      payerAmountDisplay: document.getElementById('payerAmountDisplay'),
      payMyShareBtn: document.getElementById('payMyShareBtn'),
      openUpiAppBtn: document.getElementById('openUpiAppBtn'),
      scanToPayBtn: document.getElementById('scanToPayBtn'),
      markPaidCheckbox: document.getElementById('markPaidCheckbox'),

      // QR Code Modal (Scan to Pay)
      qrPaymentModal: document.getElementById('qrPaymentModal'),
      closeQrModalBtn: document.getElementById('closeQrModalBtn'),
      closeQrModalBottomBtn: document.getElementById('closeQrModalBottomBtn'),
      qrRecipientNameDisplay: document.getElementById('qrRecipientNameDisplay'),
      qrRecipientUpiDisplay: document.getElementById('qrRecipientUpiDisplay'),
      qrPayerNameDisplay: document.getElementById('qrPayerNameDisplay'),
      qrAmountDisplay: document.getElementById('qrAmountDisplay'),
      qrOccasionDisplay: document.getElementById('qrOccasionDisplay'),
      upiQrCanvas: document.getElementById('upiQrCanvas'),

      // Action Toolbar
      copySummaryBtn: document.getElementById('copySummaryBtn'),
      shareBtn: document.getElementById('shareBtn'),
      printReceiptBtn: document.getElementById('printReceiptBtn'),
      saveHistoryBtn: document.getElementById('saveHistoryBtn'),

      // History Modal
      historyModal: document.getElementById('historyModal'),
      closeHistoryBtn: document.getElementById('closeHistoryBtn'),
      historyList: document.getElementById('historyList'),
      emptyHistoryNotice: document.getElementById('emptyHistoryNotice'),
      clearHistoryBtn: document.getElementById('clearHistoryBtn'),

      // Toast & Confetti
      toastContainer: document.getElementById('toastContainer'),
      confettiCanvas: document.getElementById('confettiCanvas')
    };
  }

  // ---------------------------------------------------------------------------
  // 4. Pure Financial Calculation Engine (Integer Paise Arithmetic)
  // ---------------------------------------------------------------------------

  /**
   * Safely converts currency input into integer paise without floating point issues.
   * Accepts string or number, strictly formatted up to 2 decimal places.
   * Returns integer paise or null if invalid.
   */
  function parseCurrencyToPaise(input) {
    if (input === null || input === undefined) return null;
    const str = String(input).trim().replace(/,/g, '');
    if (!str) return null;

    // Reject non-numeric, negative, or more than 2 decimal places
    if (!/^\d+(\.\d{1,2})?$/.test(str)) {
      return null;
    }

    const parts = str.split('.');
    const rupees = parseInt(parts[0], 10);
    if (isNaN(rupees) || rupees < 0) return null;

    let paise = 0;
    if (parts[1]) {
      const paiseStr = parts[1].padEnd(2, '0').slice(0, 2);
      paise = parseInt(paiseStr, 10);
      if (isNaN(paise) || paise < 0 || paise > 99) return null;
    }

    const totalPaise = rupees * 100 + paise;
    if (totalPaise <= 0 || !Number.isSafeInteger(totalPaise)) {
      return null;
    }

    return totalPaise;
  }

  /**
   * Formats integer paise into Indian Rupee currency format (₹).
   * Follows standard Indian numbering grouping: 1,23,456.78
   */
  function formatPaiseToINR(paise, includeSymbol = true) {
    if (typeof paise !== 'number' || isNaN(paise)) return includeSymbol ? '₹0.00' : '0.00';

    const sign = paise < 0 ? '-' : '';
    const absPaise = Math.abs(paise);
    const rupees = Math.floor(absPaise / 100);
    const remainderPaise = absPaise % 100;
    const paiseStr = remainderPaise.toString().padStart(2, '0');

    const rupeesStr = rupees.toString();
    let formattedRupees = '';

    if (rupeesStr.length <= 3) {
      formattedRupees = rupeesStr;
    } else {
      const lastThree = rupeesStr.substring(rupeesStr.length - 3);
      const otherDigits = rupeesStr.substring(0, rupeesStr.length - 3);
      formattedRupees = otherDigits.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + lastThree;
    }

    return (includeSymbol ? '₹' : '') + sign + formattedRupees + '.' + paiseStr;
  }

  /**
   * Core splitBill algorithm:
   * Uses integer division and remainder distribution to guarantee exact mathematical balance.
   */
  function splitBill(totalPaise, peopleCount, customParticipantNames = []) {
    if (!Number.isSafeInteger(totalPaise) || totalPaise <= 0) {
      throw new Error('Invalid total paise');
    }
    if (!Number.isSafeInteger(peopleCount) || peopleCount < 1 || peopleCount > MAX_SUPPORTED_PEOPLE) {
      throw new Error('Invalid people count');
    }

    const baseSharePaise = Math.floor(totalPaise / peopleCount);
    const remainderPaise = totalPaise % peopleCount;

    const shares = [];
    let allocatedSum = 0;

    for (let i = 0; i < peopleCount; i++) {
      const isExtraPaisa = i < remainderPaise;
      const sharePaise = isExtraPaisa ? baseSharePaise + 1 : baseSharePaise;
      allocatedSum += sharePaise;

      const defaultName = `Person ${i + 1}`;
      const name = (customParticipantNames[i] && customParticipantNames[i].trim()) 
        ? customParticipantNames[i].trim() 
        : defaultName;

      shares.push({
        id: i + 1,
        name: name,
        sharePaise: sharePaise,
        isExtraPaisa: isExtraPaisa,
        percentage: ((sharePaise / totalPaise) * 100).toFixed(1),
        color: AVATAR_PALETTE[i % AVATAR_PALETTE.length]
      });
    }

    // Mathematical verification assertion
    if (allocatedSum !== totalPaise) {
      throw new Error(`Integrity error: sum of shares (${allocatedSum}) does not match total bill (${totalPaise})`);
    }

    return {
      totalPaise,
      peopleCount,
      baseSharePaise,
      remainderPaise,
      shares,
      exactSumPaise: allocatedSum
    };
  }

  // ---------------------------------------------------------------------------
  // 5. Input Validation
  // ---------------------------------------------------------------------------

  function validateInputs() {
    const rawBill = el.billAmountInput.value.trim();
    const rawPeople = el.peopleCountInput.value.trim();

    // Check bill amount
    if (!rawBill) {
      return { valid: false, message: 'Please enter a total bill amount.' };
    }

    // Check negative or non-numeric
    if (!/^\d+(\.\d+)?$/.test(rawBill)) {
      return { valid: false, message: 'Enter a valid positive bill amount without symbols.' };
    }

    if (/\.\d{3,}$/.test(rawBill)) {
      return { valid: false, message: 'Please enter an amount with no more than two decimal places.' };
    }

    const totalPaise = parseCurrencyToPaise(rawBill);
    if (totalPaise === null || totalPaise <= 0) {
      return { valid: false, message: 'Enter a bill amount greater than ₹0.' };
    }

    // Check people count
    if (!rawPeople) {
      return { valid: false, message: 'Please enter the number of people.' };
    }

    const peopleNumber = Number(rawPeople);
    if (!Number.isInteger(peopleNumber) || rawPeople.includes('.')) {
      return { valid: false, message: 'Number of people must be a whole number.' };
    }

    if (peopleNumber < 1) {
      return { valid: false, message: 'Add at least one person to continue.' };
    }

    if (peopleNumber > MAX_SUPPORTED_PEOPLE) {
      return { valid: false, message: `Maximum supported participants is ${MAX_SUPPORTED_PEOPLE}.` };
    }

    // Custom mode validation
    if (state.mode === 'custom') {
      const customTotalPaise = computeCustomAllocatedPaise();
      if (customTotalPaise !== totalPaise) {
        const diff = Math.abs(totalPaise - customTotalPaise);
        const diffFormatted = formatPaiseToINR(diff);
        if (customTotalPaise < totalPaise) {
          return { valid: false, message: `Custom amounts sum to ${formatPaiseToINR(customTotalPaise)}. You still have ${diffFormatted} unallocated.` };
        } else {
          return { valid: false, message: `Custom amounts exceed total bill by ${diffFormatted}. Please adjust contributions.` };
        }
      }
    }

    return { valid: true, totalPaise, peopleCount: peopleNumber };
  }

  function showError(msg) {
    el.alertMessage.textContent = msg;
    el.validationAlert.classList.add('active');
    el.billAmountInput.classList.add('input-error');
    
    // Clear results immediately on invalid input (Requirement 4 & 11)
    hideResults();
  }

  function clearErrors() {
    el.validationAlert.classList.remove('active');
    el.alertMessage.textContent = '';
    el.billAmountInput.classList.remove('input-error');
    el.peopleCountInput.classList.remove('input-error');
  }

  // ---------------------------------------------------------------------------
  // 6. UI Rendering & Interactions
  // ---------------------------------------------------------------------------

  function setViewState(view) {
    state.viewState = view === 'results' ? 'results' : 'configuration';
    if (el.workspaceContainer) {
      el.workspaceContainer.classList.remove('view-configuration', 'view-results');
      el.workspaceContainer.classList.add(state.viewState === 'results' ? 'view-results' : 'view-configuration');
    }
  }

  function hideResults() {
    state.activeCalculation = null;
    state.selectedPayerId = null;
    state.paidParticipants.clear();
    setViewState('configuration');
    el.resultsDashboard.classList.remove('active');
    if (el.paymentSection) el.paymentSection.style.display = 'none';
    if (el.qrPaymentModal) {
      el.qrPaymentModal.style.display = 'none';
      el.qrPaymentModal.classList.remove('active');
    }
    if (el.recipientConfigDrawer) el.recipientConfigDrawer.style.display = 'none';
    el.emptyState.style.display = 'none';
  }

  function renderResults(calcResult, occasion) {
    state.activeCalculation = {
      ...calcResult,
      occasion: occasion || 'Untitled Occasion',
      timestamp: Date.now()
    };

    // Header info
    el.resultOccasion.textContent = state.activeCalculation.occasion;
    const now = new Date();
    el.resultDate.textContent = now.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    }) + ' · ' + now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

    // Hero share metrics
    el.resultTotalBill.textContent = formatPaiseToINR(calcResult.totalPaise);

    if (calcResult.remainderPaise === 0) {
      el.resultHeroAmount.textContent = formatPaiseToINR(calcResult.baseSharePaise);
      el.resultHeroSubtext.textContent = `Equal share across all ${calcResult.peopleCount} participants`;
    } else {
      const highest = formatPaiseToINR(calcResult.baseSharePaise + 1);
      const lowest = formatPaiseToINR(calcResult.baseSharePaise);
      el.resultHeroAmount.textContent = `${lowest} – ${highest}`;
      el.resultHeroSubtext.textContent = `${calcResult.remainderPaise} ${calcResult.remainderPaise === 1 ? 'person contributes' : 'people contribute'} +1 paisa to reconcile remainder`;
    }

    // Render Donut Chart
    renderDonutChart(calcResult);

    // Render Participant Cards
    renderParticipantCards(calcResult.shares);

    // Setup & Reveal Payment Section (Requirement 1 & 5)
    setupPaymentSection(calcResult);

    // Transition view to results dashboard
    el.emptyState.style.display = 'none';
    el.resultsDashboard.classList.add('active');
    setViewState('results');

    // Smooth scroll to results
    if (el.workspaceContainer) {
      el.workspaceContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // Trigger celebration confetti
    triggerCelebration();
  }

  /**
   * Renders the native SVG donut visualization.
   */
  function renderDonutChart(calcResult) {
    const svg = el.donutChartSvg;
    // Clear existing dynamic segments
    const oldSegments = svg.querySelectorAll('.chart-segment, .chart-track');
    oldSegments.forEach(s => s.remove());

    const cx = 110;
    const cy = 110;
    const r = 72;
    const circumference = 2 * Math.PI * r;

    // Background track circle
    const track = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    track.setAttribute('class', 'chart-track');
    track.setAttribute('cx', String(cx));
    track.setAttribute('cy', String(cy));
    track.setAttribute('r', String(r));
    track.setAttribute('fill', 'none');
    track.setAttribute('stroke', 'rgba(255, 255, 255, 0.06)');
    track.setAttribute('stroke-width', '16');
    svg.appendChild(track);

    let accumulatedOffset = 0;

    calcResult.shares.forEach((share, index) => {
      const shareFraction = share.sharePaise / calcResult.totalPaise;
      const arcLength = shareFraction * circumference;

      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('class', 'chart-segment');
      circle.setAttribute('cx', String(cx));
      circle.setAttribute('cy', String(cy));
      circle.setAttribute('r', String(r));
      circle.setAttribute('fill', 'none');
      circle.setAttribute('stroke', share.color);
      circle.setAttribute('stroke-width', '16');
      circle.setAttribute('stroke-dasharray', `${arcLength} ${circumference}`);
      circle.setAttribute('stroke-dashoffset', String(-accumulatedOffset));
      circle.setAttribute('data-participant-id', String(share.id));

      // Title tag for accessibility
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = `${share.name}: ${formatPaiseToINR(share.sharePaise)} (${share.percentage}%)`;
      circle.appendChild(title);

      // Interactive hover link with card
      circle.addEventListener('mouseenter', () => {
        highlightParticipant(share.id);
      });
      circle.addEventListener('mouseleave', () => {
        unhighlightParticipant(share.id);
      });

      svg.appendChild(circle);
      accumulatedOffset += arcLength;
    });

    // Center metrics
    el.chartCenterTotal.textContent = formatPaiseToINR(calcResult.totalPaise);
    el.chartCenterCount.textContent = `${calcResult.peopleCount} ${calcResult.peopleCount === 1 ? 'person' : 'people'}`;
  }

  /**
   * Renders participant cards safely using safe DOM methods (anti-XSS).
   */
  function renderParticipantCards(shares) {
    const grid = el.participantsGrid;
    grid.innerHTML = '';
    const fragment = document.createDocumentFragment();

    shares.forEach((share, index) => {
      const card = document.createElement('div');
      card.className = 'participant-card';
      card.id = `participant-card-${share.id}`;
      card.style.animationDelay = `${Math.min(index * 30, 300)}ms`;

      // Info block
      const info = document.createElement('div');
      info.className = 'participant-info';

      // Avatar
      const avatar = document.createElement('div');
      avatar.className = 'participant-avatar';
      avatar.style.backgroundColor = share.color;
      avatar.textContent = String(share.id);

      // Editable Name
      const nameWrapper = document.createElement('div');
      nameWrapper.className = 'participant-name-wrapper';

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.className = 'participant-name-input';
      nameInput.value = share.name;
      nameInput.setAttribute('aria-label', `Name for participant ${share.id}`);
      nameInput.addEventListener('input', (e) => {
        const val = e.target.value.trim() || `Person ${share.id}`;
        share.name = val;
        syncPayerSelectorNames();
        updatePaymentIntent();
      });

      nameWrapper.appendChild(nameInput);
      info.appendChild(avatar);
      info.appendChild(nameWrapper);

      // Share meta (amount + percent)
      const meta = document.createElement('div');
      meta.className = 'participant-share-meta';

      const amount = document.createElement('div');
      amount.className = 'participant-amount tabular-nums';
      amount.textContent = formatPaiseToINR(share.sharePaise);

      const percent = document.createElement('div');
      percent.className = 'participant-percent';
      percent.textContent = `${share.percentage}%`;
      if (share.isExtraPaisa) {
        const extra = document.createElement('span');
        extra.className = 'remainder-indicator';
        extra.textContent = '+1p';
        extra.title = 'Reconciled paisa';
        percent.appendChild(extra);
      }

      meta.appendChild(amount);
      meta.appendChild(percent);

      card.appendChild(info);
      card.appendChild(meta);

      // Hover sync with chart
      card.addEventListener('mouseenter', () => {
        highlightChartSegment(share.id);
      });
      card.addEventListener('mouseleave', () => {
        unhighlightChartSegment(share.id);
      });

      fragment.appendChild(card);
    });

    grid.appendChild(fragment);
  }

  function highlightParticipant(id) {
    const card = document.getElementById(`participant-card-${id}`);
    if (card) {
      card.classList.add('highlighted');
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function unhighlightParticipant(id) {
    const card = document.getElementById(`participant-card-${id}`);
    if (card) {
      card.classList.remove('highlighted');
    }
  }

  function highlightChartSegment(id) {
    const segment = el.donutChartSvg.querySelector(`.chart-segment[data-participant-id="${id}"]`);
    if (segment) {
      segment.setAttribute('stroke-width', '22');
      segment.style.filter = 'drop-shadow(0 0 8px rgba(139, 92, 246, 0.7))';
    }
  }

  function unhighlightChartSegment(id) {
    const segment = el.donutChartSvg.querySelector(`.chart-segment[data-participant-id="${id}"]`);
    if (segment) {
      segment.setAttribute('stroke-width', '16');
      segment.style.filter = '';
    }
  }

  // ---------------------------------------------------------------------------
  // 6.5. UPI Payment & Settlement Engine (Requirement 1 - 7)
  // ---------------------------------------------------------------------------

  /**
   * Validates UPI ID format strictly (e.g., username@bank, mobile@upi).
   */
  function validateUpiId(upi) {
    if (!upi || typeof upi !== 'string') return false;
    const trimmed = upi.trim();
    // Standard UPI ID pattern: 2-64 alphanumeric chars + @ + 2-32 alphabetic bank/PSP handle
    return /^[a-zA-Z0-9.\-_]{2,64}@[a-zA-Z]{2,32}$/.test(trimmed);
  }

  /**
   * Loads persisted recipient configuration safely from localStorage.
   * Never stores sensitive financial or banking credentials.
   */
  function loadRecipientConfig() {
    state.recipientUpi = (localStorage.getItem(RECIPIENT_UPI_KEY) || '').trim();
    state.recipientName = (localStorage.getItem(RECIPIENT_NAME_KEY) || '').trim();
    updateRecipientUI();
  }

  /**
   * Validates and saves recipient configuration.
   */
  function saveRecipientConfig(upi, name) {
    const trimmedUpi = (upi || '').trim();
    const trimmedName = (name || '').trim();

    if (!validateUpiId(trimmedUpi)) {
      if (el.upiValidationMsg) {
        el.upiValidationMsg.textContent = 'Please enter a valid UPI ID (e.g. name@okhdfcbank or 9876543210@paytm)';
        el.upiValidationMsg.style.color = 'var(--error)';
      }
      if (el.recipientUpiInput) {
        el.recipientUpiInput.classList.add('input-error');
        el.recipientUpiInput.focus();
      }
      showToast('Please enter a valid UPI ID to proceed.');
      return false;
    }

    state.recipientUpi = trimmedUpi;
    state.recipientName = trimmedName || 'Bill Host';
    localStorage.setItem(RECIPIENT_UPI_KEY, state.recipientUpi);
    localStorage.setItem(RECIPIENT_NAME_KEY, state.recipientName);

    if (el.upiValidationMsg) {
      el.upiValidationMsg.textContent = 'UPI ID configured and verified.';
      el.upiValidationMsg.style.color = '#4ADE80';
    }
    if (el.recipientUpiInput) el.recipientUpiInput.classList.remove('input-error');

    updateRecipientUI();
    if (el.recipientConfigDrawer) el.recipientConfigDrawer.style.display = 'none';
    if (el.toggleRecipientConfigBtn) el.toggleRecipientConfigBtn.setAttribute('aria-expanded', 'false');
    showToast('Recipient UPI configured successfully!');
    return true;
  }

  /**
   * Syncs recipient UI states across banners, drawers, and buttons.
   */
  function updateRecipientUI() {
    const isConfigured = Boolean(state.recipientUpi && validateUpiId(state.recipientUpi));

    if (el.recipientStatusText) {
      if (isConfigured) {
        el.recipientStatusText.textContent = `Pay to: ${state.recipientName || 'Host'} (${state.recipientUpi})`;
        if (el.toggleRecipientConfigBtn) el.toggleRecipientConfigBtn.classList.add('configured');
      } else {
        el.recipientStatusText.textContent = 'Recipient: Not configured';
        if (el.toggleRecipientConfigBtn) el.toggleRecipientConfigBtn.classList.remove('configured');
      }
    }

    if (el.missingRecipientAlert) {
      el.missingRecipientAlert.style.display = isConfigured ? 'none' : 'flex';
    }

    const printPayeeEl = document.getElementById('printReceiptPayee');
    if (printPayeeEl) {
      if (isConfigured) {
        printPayeeEl.textContent = `UPI Payee: ${state.recipientName || 'Host'} (${state.recipientUpi})`;
        printPayeeEl.style.display = 'block';
      } else {
        printPayeeEl.style.display = 'none';
      }
    }

    if (el.recipientUpiInput && !el.recipientUpiInput.matches(':focus')) {
      el.recipientUpiInput.value = state.recipientUpi;
    }
    if (el.recipientNameInput && !el.recipientNameInput.matches(':focus')) {
      el.recipientNameInput.value = state.recipientName;
    }

    // Refresh active payment intent
    updatePaymentIntent();
  }

  /**
   * Initializes the payment section for a newly calculated split.
   */
  function setupPaymentSection(calcResult) {
    if (!calcResult || !calcResult.shares || calcResult.shares.length === 0) return;

    state.selectedPayerId = calcResult.shares[0].id;
    state.paidParticipants.clear();

    populatePayerSelectors(calcResult.shares);
    updatePaymentIntent();
    updateParticipantPaidBadges();

    if (el.paymentSection) el.paymentSection.style.display = 'block';
  }

  /**
   * Populates both the dropdown and quick chip pills for participant selection.
   */
  function populatePayerSelectors(shares) {
    if (!el.payerSelect || !el.payerChips) return;

    // Dropdown for accessibility & keyboard navigation
    el.payerSelect.innerHTML = '';
    shares.forEach((s) => {
      const opt = document.createElement('option');
      opt.value = String(s.id);
      opt.textContent = `${s.name} — ${formatPaiseToINR(s.sharePaise)}`;
      el.payerSelect.appendChild(opt);
    });
    el.payerSelect.value = String(state.selectedPayerId || shares[0].id);

    // Quick Participant Chips
    el.payerChips.innerHTML = '';
    shares.forEach((s) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `payer-chip ${s.id === state.selectedPayerId ? 'active' : ''}`;
      chip.dataset.id = String(s.id);
      chip.setAttribute('role', 'tab');
      chip.setAttribute('aria-selected', s.id === state.selectedPayerId ? 'true' : 'false');

      const dot = document.createElement('span');
      dot.className = 'payer-chip-dot';
      dot.style.backgroundColor = s.color || 'var(--accent-primary)';

      const label = document.createElement('span');
      label.className = 'payer-chip-label';
      label.textContent = s.name;

      chip.appendChild(dot);
      chip.appendChild(label);

      chip.addEventListener('click', () => {
        handlePayerSelect(s.id);
      });

      el.payerChips.appendChild(chip);
    });
  }

  /**
   * Keeps participant labels synchronized if names are edited inline.
   */
  function syncPayerSelectorNames() {
    if (!state.activeCalculation || !state.activeCalculation.shares) return;
    const shares = state.activeCalculation.shares;

    if (el.payerSelect) {
      Array.from(el.payerSelect.options).forEach((opt) => {
        const share = shares.find(s => String(s.id) === opt.value);
        if (share) {
          opt.textContent = `${share.name} — ${formatPaiseToINR(share.sharePaise)}`;
        }
      });
    }

    if (el.payerChips) {
      const chips = el.payerChips.querySelectorAll('.payer-chip');
      chips.forEach((c) => {
        const share = shares.find(s => String(s.id) === c.dataset.id);
        if (share) {
          const label = c.querySelector('.payer-chip-label');
          if (label) label.textContent = share.name;
        }
      });
    }

    const activeShare = shares.find(s => s.id === state.selectedPayerId);
    if (activeShare && el.payerNameDisplay) {
      el.payerNameDisplay.textContent = activeShare.name;
    }
  }

  /**
   * Switches the active participant for UPI settlement.
   */
  function handlePayerSelect(payerId) {
    state.selectedPayerId = payerId;
    updatePaymentIntent();

    // If QR modal is open, re-render QR code in real-time
    if (el.qrPaymentModal && el.qrPaymentModal.style.display === 'flex') {
      openQrModal();
    }
  }

  /**
   * Constructs a standard, safe UPI payment URI.
   * Keeps literal '@' in pa=handle@bank for maximum UPI application compatibility.
   */
  function buildUpiUri(pa, pn, am, tn) {
    const params = new URLSearchParams({
      pa: pa,
      pn: pn,
      am: am,
      cu: 'INR',
      tn: tn
    });
    return `upi://pay?${params.toString().replace(/pa=[^&]+/, `pa=${pa}`)}`;
  }

  /**
   * Computes and updates the standard UPI payment URI for the selected participant.
   */
  function updatePaymentIntent() {
    if (!state.activeCalculation || !state.activeCalculation.shares) return;

    const shares = state.activeCalculation.shares;
    const selectedShare = shares.find(s => s.id === state.selectedPayerId) || shares[0];
    if (!selectedShare) return;

    state.selectedPayerId = selectedShare.id;

    // Update active highlight block
    if (el.payerAvatarBadge) {
      el.payerAvatarBadge.textContent = String(selectedShare.id);
      el.payerAvatarBadge.style.backgroundColor = selectedShare.color || 'var(--accent-primary)';
    }
    if (el.payerNameDisplay) {
      el.payerNameDisplay.textContent = selectedShare.name;
    }
    if (el.payerAmountDisplay) {
      el.payerAmountDisplay.textContent = formatPaiseToINR(selectedShare.sharePaise);
    }

    // Sync dropdown and chips active state
    if (el.payerSelect) el.payerSelect.value = String(selectedShare.id);
    if (el.payerChips) {
      const chips = el.payerChips.querySelectorAll('.payer-chip');
      chips.forEach((c) => {
        const isMatch = c.dataset.id === String(selectedShare.id);
        c.classList.toggle('active', isMatch);
        c.setAttribute('aria-selected', isMatch ? 'true' : 'false');
      });
    }

    // Update mark-as-paid checkbox
    if (el.markPaidCheckbox) {
      el.markPaidCheckbox.checked = state.paidParticipants.has(selectedShare.id);
    }

    const isConfigured = Boolean(state.recipientUpi && validateUpiId(state.recipientUpi));

    if (isConfigured) {
      // Format amount to exact two decimal places (e.g. 33.34)
      const am = (selectedShare.sharePaise / 100).toFixed(2);
      const pn = state.recipientName || 'Bill Host';
      const tn = `${state.activeCalculation.occasion} - SPLITZY (${selectedShare.name})`;

      const upiUri = buildUpiUri(state.recipientUpi, pn, am, tn);

      if (el.payMyShareBtn) {
        el.payMyShareBtn.href = upiUri;
        el.payMyShareBtn.classList.remove('disabled');
      }
      if (el.openUpiAppBtn) {
        el.openUpiAppBtn.href = upiUri;
        el.openUpiAppBtn.classList.remove('disabled');
      }
      if (el.scanToPayBtn) {
        el.scanToPayBtn.classList.remove('disabled');
      }
    } else {
      if (el.payMyShareBtn) {
        el.payMyShareBtn.removeAttribute('href');
        el.payMyShareBtn.classList.add('disabled');
      }
      if (el.openUpiAppBtn) {
        el.openUpiAppBtn.removeAttribute('href');
        el.openUpiAppBtn.classList.add('disabled');
      }
      if (el.scanToPayBtn) {
        el.scanToPayBtn.classList.add('disabled');
      }
    }
  }

  /**
   * Intercepts payment clicks if recipient UPI is missing or invalid.
   */
  function handlePayClick(e) {
    if (!state.recipientUpi || !validateUpiId(state.recipientUpi)) {
      e.preventDefault();
      if (el.recipientConfigDrawer) {
        el.recipientConfigDrawer.style.display = 'block';
        if (el.toggleRecipientConfigBtn) el.toggleRecipientConfigBtn.setAttribute('aria-expanded', 'true');
        if (el.recipientUpiInput) el.recipientUpiInput.focus();
      }
      showToast("Add the recipient's UPI ID to enable payments.");
      return;
    }
  }

  /**
   * Opens the QR Payment modal and renders a native, scannable QR code.
   */
  function openQrModal() {
    if (!state.recipientUpi || !validateUpiId(state.recipientUpi)) {
      if (el.recipientConfigDrawer) {
        el.recipientConfigDrawer.style.display = 'block';
        if (el.toggleRecipientConfigBtn) el.toggleRecipientConfigBtn.setAttribute('aria-expanded', 'true');
        if (el.recipientUpiInput) el.recipientUpiInput.focus();
      }
      showToast("Add the recipient's UPI ID to enable payments.");
      return;
    }

    if (!state.activeCalculation || !state.activeCalculation.shares) return;

    const shares = state.activeCalculation.shares;
    const selectedShare = shares.find(s => s.id === state.selectedPayerId) || shares[0];
    if (!selectedShare) return;

    const am = (selectedShare.sharePaise / 100).toFixed(2);
    const pn = state.recipientName || 'Bill Host';
    const tn = `${state.activeCalculation.occasion} - SPLITZY (${selectedShare.name})`;

    // Populate modal summary text
    if (el.qrRecipientNameDisplay) el.qrRecipientNameDisplay.textContent = pn;
    if (el.qrRecipientUpiDisplay) el.qrRecipientUpiDisplay.textContent = state.recipientUpi;
    if (el.qrPayerNameDisplay) el.qrPayerNameDisplay.textContent = selectedShare.name;
    if (el.qrAmountDisplay) el.qrAmountDisplay.textContent = formatPaiseToINR(selectedShare.sharePaise);
    if (el.qrOccasionDisplay) el.qrOccasionDisplay.textContent = state.activeCalculation.occasion;

    const upiUri = buildUpiUri(state.recipientUpi, pn, am, tn);

    // Render pure JS native QR Code onto #upiQrCanvas
    QRCode.drawToCanvas(upiUri, el.upiQrCanvas, {
      size: 220,
      margin: 4,
      ecLevel: 'M'
    });

    if (el.qrPaymentModal) {
      el.qrPaymentModal.style.display = 'flex';
      el.qrPaymentModal.classList.add('active');
    }
  }

  function closeQrModal() {
    if (el.qrPaymentModal) {
      el.qrPaymentModal.style.display = 'none';
      el.qrPaymentModal.classList.remove('active');
    }
  }

  function toggleRecipientConfigDrawer() {
    if (!el.recipientConfigDrawer) return;
    const isHidden = el.recipientConfigDrawer.style.display === 'none';
    el.recipientConfigDrawer.style.display = isHidden ? 'block' : 'none';
    if (el.toggleRecipientConfigBtn) {
      el.toggleRecipientConfigBtn.setAttribute('aria-expanded', isHidden ? 'true' : 'false');
    }
    if (isHidden && el.recipientUpiInput) {
      el.recipientUpiInput.focus();
    }
  }

  function handleMarkPaidToggle(e) {
    if (!state.selectedPayerId) return;
    const isChecked = e.target.checked;
    if (isChecked) {
      state.paidParticipants.add(state.selectedPayerId);
      const name = el.payerNameDisplay ? el.payerNameDisplay.textContent : 'Participant';
      showToast(`Marked ${name} as paid (User-confirmed)`);
    } else {
      state.paidParticipants.delete(state.selectedPayerId);
    }
    updateParticipantPaidBadges();
  }

  function updateParticipantPaidBadges() {
    if (!state.activeCalculation || !state.activeCalculation.shares) return;
    state.activeCalculation.shares.forEach((share) => {
      const card = document.getElementById(`participant-card-${share.id}`);
      if (card) {
        let badge = card.querySelector('.user-paid-badge');
        if (state.paidParticipants.has(share.id)) {
          if (!badge) {
            badge = document.createElement('span');
            badge.className = 'user-paid-badge';
            badge.textContent = 'Paid (User-confirmed)';
            const meta = card.querySelector('.participant-share-meta');
            if (meta) meta.appendChild(badge);
          }
        } else {
          if (badge) badge.remove();
        }
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 7. Custom Split Mode Logic
  // ---------------------------------------------------------------------------

  function setupCustomParticipants(peopleCount) {
    state.customParticipants = [];
    const list = el.customParticipantsList;
    list.innerHTML = '';

    const billPaise = parseCurrencyToPaise(el.billAmountInput.value) || 0;
    const baseShare = Math.floor(billPaise / peopleCount);
    const remainder = billPaise % peopleCount;

    for (let i = 0; i < peopleCount; i++) {
      const share = i < remainder ? baseShare + 1 : baseShare;
      state.customParticipants.push({
        id: i + 1,
        name: `Person ${i + 1}`,
        amountPaise: share
      });

      const row = document.createElement('div');
      row.className = 'custom-participant-row';

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.className = 'custom-name-input';
      nameInput.value = `Person ${i + 1}`;
      nameInput.placeholder = `Person ${i + 1}`;
      nameInput.addEventListener('input', (e) => {
        state.customParticipants[i].name = e.target.value.trim() || `Person ${i + 1}`;
      });

      const amountInput = document.createElement('input');
      amountInput.type = 'number';
      amountInput.step = '0.01';
      amountInput.min = '0';
      amountInput.className = 'custom-amount-input';
      amountInput.value = (share / 100).toFixed(2);
      amountInput.addEventListener('input', (e) => {
        const paise = parseCurrencyToPaise(e.target.value) || 0;
        state.customParticipants[i].amountPaise = paise;
        updateCustomAllocationBadge();
      });

      row.appendChild(nameInput);
      row.appendChild(amountInput);
      list.appendChild(row);
    }

    updateCustomAllocationBadge();
  }

  function computeCustomAllocatedPaise() {
    return state.customParticipants.reduce((sum, p) => sum + (p.amountPaise || 0), 0);
  }

  function updateCustomAllocationBadge() {
    const totalPaise = parseCurrencyToPaise(el.billAmountInput.value) || 0;
    const allocatedPaise = computeCustomAllocatedPaise();
    const remainingPaise = totalPaise - allocatedPaise;

    if (remainingPaise === 0) {
      el.unallocatedBadge.textContent = 'Matched: 100%';
      el.unallocatedBadge.className = 'unallocated-badge matched';
    } else if (remainingPaise > 0) {
      el.unallocatedBadge.textContent = `Remaining: ${formatPaiseToINR(remainingPaise)}`;
      el.unallocatedBadge.className = 'unallocated-badge unmatched';
    } else {
      el.unallocatedBadge.textContent = `Exceeded: +${formatPaiseToINR(-remainingPaise)}`;
      el.unallocatedBadge.className = 'unallocated-badge unmatched';
    }
  }

  function distributeRemainingEqually() {
    const totalPaise = parseCurrencyToPaise(el.billAmountInput.value);
    if (!totalPaise || totalPaise <= 0) return;

    const count = state.customParticipants.length;
    if (count <= 0) return;

    const baseShare = Math.floor(totalPaise / count);
    const remainder = totalPaise % count;

    const amountInputs = el.customParticipantsList.querySelectorAll('.custom-amount-input');
    state.customParticipants.forEach((p, i) => {
      const share = i < remainder ? baseShare + 1 : baseShare;
      p.amountPaise = share;
      if (amountInputs[i]) {
        amountInputs[i].value = (share / 100).toFixed(2);
      }
    });

    updateCustomAllocationBadge();
  }

  // ---------------------------------------------------------------------------
  // 8. Actions (Copy Summary, Web Share, Print, Save)
  // ---------------------------------------------------------------------------

  function generateShareSummaryText() {
    if (!state.activeCalculation) return '';

    const calc = state.activeCalculation;
    let text = `SPLITZY — BILL SUMMARY\n\n`;
    text += `Occasion: ${calc.occasion}\n`;
    text += `Total: ${formatPaiseToINR(calc.totalPaise)}\n`;
    text += `People: ${calc.peopleCount}\n`;

    if (state.recipientUpi && validateUpiId(state.recipientUpi)) {
      text += `Payee UPI: ${state.recipientName || 'Host'} (${state.recipientUpi})\n`;
    }

    text += `\nParticipant Breakdown:\n`;
    calc.shares.forEach((share) => {
      const isPaid = state.paidParticipants.has(share.id);
      text += `• ${share.name} — ${formatPaiseToINR(share.sharePaise)}${isPaid ? ' [Paid]' : ''}\n`;
    });

    text += `\nTotal allocated: ${formatPaiseToINR(calc.exactSumPaise)}\n\n`;
    text += `Split bills. Not friendships.`;
    return text;
  }

  async function copySummary() {
    const text = generateShareSummaryText();
    if (!text) return;

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for non-secure contexts
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      showToast('Summary copied to clipboard!');
    } catch (err) {
      showToast('Unable to copy to clipboard.');
    }
  }

  async function shareSummary() {
    const text = generateShareSummaryText();
    if (!text) return;

    if (navigator.share) {
      try {
        await navigator.share({
          title: `SPLITZY Bill Split: ${state.activeCalculation.occasion}`,
          text: text
        });
        showToast('Shared successfully!');
      } catch (err) {
        if (err.name !== 'AbortError') {
          copySummary();
        }
      }
    } else {
      copySummary();
    }
  }

  function printReceipt() {
    if (!state.activeCalculation) return;
    window.print();
  }

  // ---------------------------------------------------------------------------
  // 9. Bill History Management (Local Storage)
  // ---------------------------------------------------------------------------

  function getSavedHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveBillToHistory() {
    if (!state.activeCalculation) return;

    try {
      const history = getSavedHistory();
      const newRecord = {
        id: 'split_' + Date.now(),
        occasion: state.activeCalculation.occasion,
        totalPaise: state.activeCalculation.totalPaise,
        peopleCount: state.activeCalculation.peopleCount,
        shares: state.activeCalculation.shares.map(s => ({
          name: s.name,
          sharePaise: s.sharePaise,
          percentage: s.percentage
        })),
        timestamp: Date.now()
      };

      history.unshift(newRecord);
      // Keep up to 20 past records
      if (history.length > 20) history.pop();

      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
      showToast('Split saved to history!');
      renderHistoryModal();
    } catch (err) {
      showToast('Could not save to history.');
    }
  }

  function deleteHistoryItem(recordId) {
    try {
      let history = getSavedHistory();
      history = history.filter(item => item.id !== recordId);
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
      renderHistoryModal();
      showToast('Record deleted');
    } catch (err) {
      // Ignored
    }
  }

  function clearAllHistory() {
    try {
      localStorage.removeItem(HISTORY_STORAGE_KEY);
      renderHistoryModal();
      showToast('All history cleared');
    } catch (err) {
      // Ignored
    }
  }

  function renderHistoryModal() {
    const history = getSavedHistory();
    const list = el.historyList;
    list.innerHTML = '';

    if (!history || history.length === 0) {
      el.emptyHistoryNotice.style.display = 'block';
      el.clearHistoryBtn.disabled = true;
      return;
    }

    el.emptyHistoryNotice.style.display = 'none';
    el.clearHistoryBtn.disabled = false;

    history.forEach(item => {
      const row = document.createElement('div');
      row.className = 'history-item';

      const infoGroup = document.createElement('div');
      infoGroup.className = 'history-info-group';

      const occasion = document.createElement('div');
      occasion.className = 'history-occasion';
      occasion.textContent = item.occasion || 'Untitled Occasion';

      const meta = document.createElement('div');
      meta.className = 'history-meta';
      const d = new Date(item.timestamp);
      meta.textContent = `${item.peopleCount} people · ${d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}`;

      infoGroup.appendChild(occasion);
      infoGroup.appendChild(meta);

      const rightGroup = document.createElement('div');
      rightGroup.style.display = 'flex';
      rightGroup.style.alignItems = 'center';
      rightGroup.style.gap = '0.75rem';

      const amount = document.createElement('div');
      amount.className = 'history-amount';
      amount.textContent = formatPaiseToINR(item.totalPaise);

      row.style.cursor = 'pointer';
      row.title = 'Click to view this split in results';
      row.addEventListener('click', (e) => {
        if (e.target.closest('.history-delete-btn')) return;
        closeHistory();
        renderResults(item, item.occasion);
        showToast(`Loaded "${item.occasion || 'Saved Split'}"`);
      });

      const delBtn = document.createElement('button');
      delBtn.className = 'history-delete-btn btn btn-icon';
      delBtn.setAttribute('aria-label', 'Delete split');
      delBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
      `;
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteHistoryItem(item.id);
      });

      rightGroup.appendChild(amount);
      rightGroup.appendChild(delBtn);

      row.appendChild(infoGroup);
      row.appendChild(rightGroup);
      list.appendChild(row);
    });
  }

  // ---------------------------------------------------------------------------
  // 10. Toast Notification System
  // ---------------------------------------------------------------------------

  function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
    `;

    const text = document.createElement('span');
    text.textContent = message;

    toast.appendChild(icon);
    toast.appendChild(text);
    el.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => toast.remove(), 250);
    }, 2800);
  }

  // ---------------------------------------------------------------------------
  // 11. Celebration Confetti (Lightweight Native Canvas)
  // ---------------------------------------------------------------------------

  function triggerCelebration() {
    // Respect reduced motion
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    const canvas = el.confettiCanvas;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const colors = ['#8B5CF6', '#22D3EE', '#34D399', '#A78BFA', '#F59E0B'];
    const particleCount = 36;
    const particles = [];

    for (let i = 0; i < particleCount; i++) {
      particles.push({
        x: canvas.width / 2 + (Math.random() - 0.5) * 200,
        y: canvas.height * 0.45 + (Math.random() - 0.5) * 80,
        vx: (Math.random() - 0.5) * 8,
        vy: (Math.random() - 1) * 8 - 3,
        size: Math.random() * 6 + 4,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * 360,
        rotationSpeed: (Math.random() - 0.5) * 8,
        opacity: 1
      });
    }

    let startTime = null;

    function animateConfetti(timestamp) {
      if (!startTime) startTime = timestamp;
      const progress = timestamp - startTime;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      let alive = false;
      particles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.25; // gravity
        p.rotation += p.rotationSpeed;
        p.opacity = Math.max(0, 1 - progress / 1800);

        if (p.opacity > 0) {
          alive = true;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate((p.rotation * Math.PI) / 180);
          ctx.fillStyle = p.color;
          ctx.globalAlpha = p.opacity;
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 1.4);
          ctx.restore();
        }
      });

      if (alive && progress < 2000) {
        requestAnimationFrame(animateConfetti);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }

    requestAnimationFrame(animateConfetti);
  }

  // ---------------------------------------------------------------------------
  // 12. Theme Switcher
  // ---------------------------------------------------------------------------

  function initTheme() {
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY) || 'dark';
    setTheme(savedTheme);
  }

  function setTheme(theme) {
    state.currentTheme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_STORAGE_KEY, theme);

    if (theme === 'light') {
      el.themeIcon.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
        </svg>
      `;
      el.themeToggleBtn.setAttribute('title', 'Switch to dark theme');
    } else {
      el.themeIcon.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="5"></circle>
          <line x1="12" y1="1" x2="12" y2="3"></line>
          <line x1="12" y1="21" x2="12" y2="23"></line>
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
          <line x1="1" y1="12" x2="3" y2="12"></line>
          <line x1="21" y1="12" x2="23" y2="12"></line>
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
        </svg>
      `;
      el.themeToggleBtn.setAttribute('title', 'Switch to light theme');
    }
  }

  function toggleTheme() {
    setTheme(state.currentTheme === 'dark' ? 'light' : 'dark');
  }

  // ---------------------------------------------------------------------------
  // 13. Complete Reset & Fresh Startup (Requirement 5 & 21 Compliance)
  // ---------------------------------------------------------------------------

  /**
   * Returns workspace to fresh default state.
   * Completely hides any previous calculations.
   */
  function resetAll(clearInputs = true) {
    if (clearInputs) {
      el.billForm.reset();
      el.occasionInput.value = '';
      el.billAmountInput.value = '';
      el.peopleCountInput.value = '4';
    }

    clearErrors();
    hideResults();
    state.mode = 'equal';
    el.splitModeBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === 'equal');
    });
    el.customSplitSection.classList.remove('active');
  }

  // ---------------------------------------------------------------------------
  // 14. Event Listeners & Binding
  // ---------------------------------------------------------------------------

  function bindEvents() {
    // Theme toggle
    el.themeToggleBtn.addEventListener('click', toggleTheme);

    // Stepper buttons
    el.decreasePeopleBtn.addEventListener('click', () => {
      const current = parseInt(el.peopleCountInput.value, 10) || 4;
      if (current > 1) {
        el.peopleCountInput.value = String(current - 1);
        handlePeopleChange();
      }
    });

    el.increasePeopleBtn.addEventListener('click', () => {
      const current = parseInt(el.peopleCountInput.value, 10) || 4;
      if (current < MAX_SUPPORTED_PEOPLE) {
        el.peopleCountInput.value = String(current + 1);
        handlePeopleChange();
      }
    });

    el.peopleCountInput.addEventListener('input', handlePeopleChange);

    function handlePeopleChange() {
      // Hide results if input changes (Requirement 11)
      hideResults();
      clearErrors();
      const count = parseInt(el.peopleCountInput.value, 10);
      if (state.mode === 'custom' && Number.isInteger(count) && count >= 1 && count <= MAX_SUPPORTED_PEOPLE) {
        setupCustomParticipants(count);
      }
    }

    // Quick Amount Chips
    el.quickChips.forEach(chip => {
      chip.addEventListener('click', () => {
        el.billAmountInput.value = chip.dataset.amount;
        hideResults();
        clearErrors();
        if (state.mode === 'custom') {
          updateCustomAllocationBadge();
        }
      });
    });

    // Bill input change
    el.billAmountInput.addEventListener('input', () => {
      hideResults();
      clearErrors();
      if (state.mode === 'custom') {
        updateCustomAllocationBadge();
      }
    });

    // Occasion input change
    el.occasionInput.addEventListener('input', () => {
      if (state.activeCalculation) {
        state.activeCalculation.occasion = el.occasionInput.value.trim() || 'Untitled Occasion';
        el.resultOccasion.textContent = state.activeCalculation.occasion;
      }
    });

    // Split Mode Switcher (Equal vs Custom)
    el.splitModeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        state.mode = mode;
        el.splitModeBtns.forEach(b => b.classList.toggle('active', b === btn));

        if (mode === 'custom') {
          const people = parseInt(el.peopleCountInput.value, 10) || 4;
          setupCustomParticipants(people);
          el.customSplitSection.classList.add('active');
        } else {
          el.customSplitSection.classList.remove('active');
        }
        hideResults();
        clearErrors();
      });
    });

    // Custom distribute remaining equally button
    el.distributeRemainingBtn.addEventListener('click', distributeRemainingEqually);

    // Form Submit / "Split the Bill" Primary Action
    el.billForm.addEventListener('submit', (e) => {
      e.preventDefault();
      clearErrors();

      const validation = validateInputs();
      if (!validation.valid) {
        showError(validation.message);
        return;
      }

      // Visual loading state (350ms for tactile feedback)
      el.splitBtn.classList.add('loading');
      el.splitBtn.disabled = true;

      setTimeout(() => {
        el.splitBtn.classList.remove('loading');
        el.splitBtn.disabled = false;

        try {
          let calcResult;

          if (state.mode === 'custom') {
            const shares = state.customParticipants.map((p, i) => ({
              id: p.id,
              name: p.name,
              sharePaise: p.amountPaise,
              isExtraPaisa: false,
              percentage: ((p.amountPaise / validation.totalPaise) * 100).toFixed(1),
              color: AVATAR_PALETTE[i % AVATAR_PALETTE.length]
            }));

            calcResult = {
              totalPaise: validation.totalPaise,
              peopleCount: validation.peopleCount,
              baseSharePaise: shares[0] ? shares[0].sharePaise : 0,
              remainderPaise: 0,
              shares: shares,
              exactSumPaise: validation.totalPaise
            };
          } else {
            calcResult = splitBill(validation.totalPaise, validation.peopleCount);
          }

          renderResults(calcResult, el.occasionInput.value.trim());
        } catch (err) {
          showError(err.message || 'Error executing calculation.');
        }
      }, 350);
    });

    // Reset button
    el.resetBtn.addEventListener('click', () => {
      resetAll(true);
      showToast('Form reset to fresh state');
    });

    // Toolbar actions
    el.copySummaryBtn.addEventListener('click', copySummary);
    el.shareBtn.addEventListener('click', shareSummary);
    el.printReceiptBtn.addEventListener('click', printReceipt);
    el.saveHistoryBtn.addEventListener('click', saveBillToHistory);

    // Results View Actions (Edit Bill & Reset)
    if (el.resultsResetBtn) {
      el.resultsResetBtn.addEventListener('click', () => {
        resetAll(true);
        showToast('Form reset to fresh state');
      });
    }

    if (el.resultsResetTopBtn) {
      el.resultsResetTopBtn.addEventListener('click', () => {
        resetAll(true);
        showToast('Form reset to fresh state');
      });
    }

    if (el.resultsEditBtn) {
      el.resultsEditBtn.addEventListener('click', () => {
        setViewState('configuration');
        if (el.formCard) {
          el.formCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    }

    // Payment & UPI Event Handlers
    if (el.toggleRecipientConfigBtn) {
      el.toggleRecipientConfigBtn.addEventListener('click', toggleRecipientConfigDrawer);
    }

    if (el.saveRecipientBtn) {
      el.saveRecipientBtn.addEventListener('click', () => {
        saveRecipientConfig(el.recipientUpiInput.value, el.recipientNameInput.value);
      });
    }

    if (el.cancelRecipientBtn) {
      el.cancelRecipientBtn.addEventListener('click', () => {
        if (el.recipientConfigDrawer) el.recipientConfigDrawer.style.display = 'none';
        if (el.toggleRecipientConfigBtn) el.toggleRecipientConfigBtn.setAttribute('aria-expanded', 'false');
      });
    }

    if (el.setupRecipientPromptBtn) {
      el.setupRecipientPromptBtn.addEventListener('click', () => {
        if (el.recipientConfigDrawer) {
          el.recipientConfigDrawer.style.display = 'block';
          if (el.toggleRecipientConfigBtn) el.toggleRecipientConfigBtn.setAttribute('aria-expanded', 'true');
          if (el.recipientUpiInput) el.recipientUpiInput.focus();
        }
      });
    }

    if (el.recipientUpiInput) {
      el.recipientUpiInput.addEventListener('input', (e) => {
        const val = e.target.value.trim();
        if (!val) {
          if (el.upiValidationIcon) el.upiValidationIcon.textContent = '';
          if (el.upiValidationMsg) {
            el.upiValidationMsg.textContent = 'e.g. name@okhdfcbank, mobile@paytm';
            el.upiValidationMsg.style.color = 'var(--text-muted)';
          }
          el.recipientUpiInput.classList.remove('input-error');
        } else if (validateUpiId(val)) {
          if (el.upiValidationIcon) el.upiValidationIcon.textContent = '✓';
          if (el.upiValidationMsg) {
            el.upiValidationMsg.textContent = 'Valid UPI ID format';
            el.upiValidationMsg.style.color = '#4ADE80';
          }
          el.recipientUpiInput.classList.remove('input-error');
        } else {
          if (el.upiValidationIcon) el.upiValidationIcon.textContent = '✗';
          if (el.upiValidationMsg) {
            el.upiValidationMsg.textContent = 'Incomplete or invalid format';
            el.upiValidationMsg.style.color = 'var(--error)';
          }
        }
      });
    }

    if (el.payerSelect) {
      el.payerSelect.addEventListener('change', (e) => {
        const payerId = parseInt(e.target.value, 10);
        if (Number.isInteger(payerId)) {
          handlePayerSelect(payerId);
        }
      });
    }

    if (el.payMyShareBtn) {
      el.payMyShareBtn.addEventListener('click', handlePayClick);
    }
    if (el.openUpiAppBtn) {
      el.openUpiAppBtn.addEventListener('click', handlePayClick);
    }
    if (el.scanToPayBtn) {
      el.scanToPayBtn.addEventListener('click', openQrModal);
    }

    if (el.markPaidCheckbox) {
      el.markPaidCheckbox.addEventListener('change', handleMarkPaidToggle);
    }

    // QR Modal close handlers
    if (el.closeQrModalBtn) {
      el.closeQrModalBtn.addEventListener('click', closeQrModal);
    }
    if (el.closeQrModalBottomBtn) {
      el.closeQrModalBottomBtn.addEventListener('click', closeQrModal);
    }
    if (el.qrPaymentModal) {
      el.qrPaymentModal.addEventListener('click', (e) => {
        if (e.target === el.qrPaymentModal) {
          closeQrModal();
        }
      });
    }

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeQrModal();
      }
    });

    // History modal
    el.historyToggleBtn.addEventListener('click', () => {
      renderHistoryModal();
      el.historyModal.classList.add('active');
    });

    el.closeHistoryBtn.addEventListener('click', () => {
      el.historyModal.classList.remove('active');
    });

    el.historyModal.addEventListener('click', (e) => {
      if (e.target === el.historyModal) {
        el.historyModal.classList.remove('active');
      }
    });

    el.clearHistoryBtn.addEventListener('click', clearAllHistory);

    // Window resize - re-center confetti canvas
    window.addEventListener('resize', () => {
      if (el.confettiCanvas) {
        el.confettiCanvas.width = window.innerWidth;
        el.confettiCanvas.height = window.innerHeight;
      }
    });

    // Handle back-forward cache or reload explicitly (Requirement 5)
    window.addEventListener('pageshow', (event) => {
      if (event.persisted) {
        resetAll(true);
        setViewState('configuration');
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 15. Application Bootstrapping
  // ---------------------------------------------------------------------------

  function init() {
    cacheDom();
    initTheme();
    loadRecipientConfig();
    bindEvents();
    // Guarantee fresh configuration-only state on initial page load (Requirements 1 & 4)
    resetAll(false);
    setViewState('configuration');
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
