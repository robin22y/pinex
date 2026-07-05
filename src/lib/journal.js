/**
 * Journal LocalStorage operations
 * All journal content lives in LocalStorage.
 * Only metadata syncs to Supabase (journal_meta table).
 */

const STORAGE_KEY = 'pinex_journal';

const DEFAULT_SCHEMA = {
  version: '1.0',
  entries: []
};

const EMPTY_ENTRY = {
  id: undefined,
  ticker: '',
  company_name: '',
  status: 'watching',
  entry_date: new Date().toISOString().split('T')[0],
  sell_date: null,
  before_buying: {
    avg_price: null,
    position_size: null,
    max_allocation: null,
    confidence: 5,
    thesis: '',
    fundamental_reasons: '',
    technical_reasons: '',
    expected_catalysts: '',
    biggest_risks: '',
    competition: '',
    what_must_go_right: '',
    what_could_break_thesis: '',
    conditions_to_sell: '',
    why_i_might_be_wrong: '',
    bear_case: '',
    emotional_state: 'calm',
    checklist: {
      position_sizing: false,
      understand_downside: false,
      read_earnings: false,
      checked_dilution: false,
      checked_insider: false,
      checked_short_report: false,
      checked_ceo: false,
      checked_competitors: false,
      understand_catalysts: false
    }
  },
  holding_reviews: [],
  while_holding: {
    hold_criteria: '',
    sell_triggers: ''
  },
  after_selling: {
    date_sold: null,
    avg_exit: null,
    profit_loss: null,
    why_sold: '',
    thesis_failed: '',
    emotions_influenced: '',
    would_buy_again: '',
    what_learned: ''
  },
  review_90day: {
    due_date: null,
    completed: false,
    thesis_correct: '',
    company_better_than_expected: '',
    sold_too_early: '',
    same_decision_again: '',
    process_score: 5
  },
  timeline_events: []
};

export const getJournal = () => {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : { ...DEFAULT_SCHEMA };
  } catch (e) {
    console.error('Failed to read journal:', e);
    return { ...DEFAULT_SCHEMA };
  }
};

export const saveJournal = (journal) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(journal));
    return true;
  } catch (e) {
    console.error('Failed to save journal:', e);
    return false;
  }
};

export const getEntry = (ticker) => {
  const journal = getJournal();
  return journal.entries.find(e => e.ticker === ticker.toUpperCase());
};

export const getAllEntries = () => {
  const journal = getJournal();
  return journal.entries || [];
};

export const createEntry = (data) => {
  const journal = getJournal();
  const entry = {
    id: crypto.randomUUID(),
    ticker: data.ticker.toUpperCase(),
    company_name: data.company_name,
    status: data.status || 'watching',
    entry_date: data.entry_date || new Date().toISOString().split('T')[0],
    sell_date: null,
    before_buying: data.before_buying || { ...EMPTY_ENTRY.before_buying },
    holding_reviews: [],
    after_selling: { ...EMPTY_ENTRY.after_selling },
    review_90day: { ...EMPTY_ENTRY.review_90day }
  };
  journal.entries.push(entry);
  saveJournal(journal);
  return entry;
};

export const updateEntry = (ticker, updates) => {
  const journal = getJournal();
  const entry = journal.entries.find(e => e.ticker === ticker.toUpperCase());
  if (entry) {
    Object.assign(entry, updates);
    entry.updated_at = new Date().toISOString();
    saveJournal(journal);
  }
  return entry;
};

export const deleteEntry = (ticker) => {
  const journal = getJournal();
  const index = journal.entries.findIndex(e => e.ticker === ticker.toUpperCase());
  if (index > -1) {
    journal.entries.splice(index, 1);
    saveJournal(journal);
    return true;
  }
  return false;
};

export const addHoldingReview = (ticker, review) => {
  const entry = getEntry(ticker);
  if (entry) {
    entry.holding_reviews.push({
      id: crypto.randomUUID(),
      date: review.date || new Date().toISOString().split('T')[0],
      reason: review.reason,
      thesis_changed: review.thesis_changed,
      action: review.action,
      confidence: review.confidence,
      notes: review.notes || ''
    });
    updateEntry(ticker, entry);
    return entry;
  }
  return null;
};

export const updateAfterSelling = (ticker, data) => {
  const entry = getEntry(ticker);
  if (entry) {
    entry.status = 'sold';
    entry.sell_date = data.date_sold;
    entry.after_selling = {
      date_sold: data.date_sold,
      avg_exit: data.avg_exit,
      why_sold: data.why_sold,
      thesis_failed: data.thesis_failed,
      emotions_influenced: data.emotions_influenced,
      would_buy_again: data.would_buy_again,
      what_learned: data.what_learned
    };
    updateEntry(ticker, entry);
    return entry;
  }
  return null;
};

export const updateBeforeBuying = (ticker, data) => {
  const entry = getEntry(ticker);
  if (entry) {
    entry.before_buying = { ...entry.before_buying, ...data };
    updateEntry(ticker, entry);
    return entry;
  }
  return null;
};

export const updateWhileHolding = (ticker, data) => {
  const entry = getEntry(ticker);
  if (entry) {
    entry.while_holding = {
      hold_criteria: data.hold_criteria || '',
      sell_triggers: data.sell_triggers || ''
    };
    updateEntry(ticker, entry);
    return entry;
  }
  return null;
};

export const update90DayReview = (ticker, data) => {
  const entry = getEntry(ticker);
  if (entry) {
    entry.review_90day = {
      due_date: entry.review_90day.due_date,
      completed: true,
      thesis_correct: data.thesis_correct,
      company_better_than_expected: data.company_better_than_expected,
      sold_too_early: data.sold_too_early,
      same_decision_again: data.same_decision_again,
      process_score: data.process_score
    };
    updateEntry(ticker, entry);
    return entry;
  }
  return null;
};

export const getStats = () => {
  const entries = getAllEntries();
  const today = new Date().toISOString().split('T')[0];

  return {
    watching: entries.filter(e => e.status === 'watching').length,
    owned: entries.filter(e => e.status === 'owned').length,
    sold: entries.filter(e => e.status === 'sold').length,
    reviewsDue: entries.filter(e => e.review_90day.due_date && e.review_90day.due_date === today && !e.review_90day.completed).length
  };
};

export const exportAsJSON = () => {
  const journal = getJournal();
  const dataStr = JSON.stringify(journal, null, 2);
  const dataBlob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(dataBlob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'pinex-journal.json';
  link.click();
  URL.revokeObjectURL(url);
};

export const importFromJSON = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (data.version && data.entries) {
          saveJournal(data);
          resolve(true);
        } else {
          reject(new Error('Invalid journal format'));
        }
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
};

export const calculateProfitLoss = (entryPrice, exitPrice, quantity) => {
  if (!entryPrice || !exitPrice || !quantity) return null;
  const pnl = (exitPrice - entryPrice) * quantity;
  const pnlPercent = ((exitPrice - entryPrice) / entryPrice) * 100;
  return { pnl, pnlPercent };
};

export const getBackupReminder = () => {
  const key = 'pinex_journal_last_backup';
  const lastBackup = localStorage.getItem(key);
  if (!lastBackup) return null;

  const lastDate = new Date(lastBackup);
  const now = new Date();
  const daysSince = Math.floor((now - lastDate) / (1000 * 60 * 60 * 24));

  return daysSince > 7 ? daysSince : null;
};

export const recordBackup = () => {
  localStorage.setItem('pinex_journal_last_backup', new Date().toISOString());
};

export const formatJournalAsMarkdown = () => {
  const entries = getAllEntries();
  let md = '# My Investment Decision Journal\n\n';

  entries.forEach(entry => {
    md += `## ${entry.ticker} — ${entry.company_name}\n`;
    md += `**Status:** ${entry.status} | **Entry Date:** ${entry.entry_date}\n\n`;

    md += `### Before Buying\n`;
    md += `**Thesis:** ${entry.before_buying.thesis}\n`;
    md += `**Fundamental Reasons:** ${entry.before_buying.fundamental_reasons}\n`;
    md += `**Technical Reasons:** ${entry.before_buying.technical_reasons}\n`;
    md += `**Biggest Risks:** ${entry.before_buying.biggest_risks}\n`;
    md += `**Why I Might Be Wrong:** ${entry.before_buying.why_i_might_be_wrong}\n`;
    md += `**Bear Case:** ${entry.before_buying.bear_case}\n`;
    md += `**Confidence:** ${entry.before_buying.confidence}/10\n`;
    md += `**Emotional State:** ${entry.before_buying.emotional_state}\n\n`;

    if (entry.holding_reviews.length > 0) {
      md += `### Holding Reviews\n`;
      entry.holding_reviews.forEach(review => {
        md += `- **${review.date}:** ${review.reason} | Thesis: ${review.thesis_changed} | Action: ${review.action} | Notes: ${review.notes}\n`;
      });
      md += '\n';
    }

    if (entry.status === 'sold' && entry.after_selling.date_sold) {
      md += `### After Selling\n`;
      md += `**Sold:** ${entry.after_selling.date_sold}\n`;
      md += `**Why:** ${entry.after_selling.why_sold}\n`;
      md += `**Learned:** ${entry.after_selling.what_learned}\n\n`;
    }
  });

  return md;
};

export const exportJournalToPDF = async () => {
  try {
    const { jsPDF } = await import('jspdf');
    if (!jsPDF) {
      console.error('jsPDF library not loaded');
      return;
    }

    const entries = getAllEntries();
    const doc = new jsPDF();

    // PineX branding and date
    const today = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    // Header with PineX branding
    doc.setFillColor(251, 191, 36); // amber
    doc.rect(0, 0, 210, 25, 'F');
    doc.setTextColor(11, 14, 17); // dark text
    doc.setFontSize(24);
    doc.setFont(undefined, 'bold');
    doc.text('PineX Journal', 15, 18);

    doc.setTextColor(100, 116, 139); // muted text
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    doc.text(`Updated: ${today}`, 15, 23);

    let yPosition = 35;
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 15;
    const lineHeight = 5;
    const maxWidth = 180;

    // Add entries
    entries.forEach((entry, index) => {
      // Check if we need a new page
      if (yPosition > pageHeight - 20) {
        doc.addPage();
        yPosition = 15;
      }

      // Entry header with ticker
      doc.setTextColor(11, 14, 17);
      doc.setFontSize(14);
      doc.setFont(undefined, 'bold');
      doc.text(`${entry.ticker} — ${entry.company_name}`, margin, yPosition);
      yPosition += 8;

      // Entry metadata
      doc.setFontSize(9);
      doc.setFont(undefined, 'normal');
      doc.setTextColor(100, 116, 139);
      const statusLabel = entry.status.charAt(0).toUpperCase() + entry.status.slice(1);
      const dateStr = new Date(entry.entry_date).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: '2-digit'
      });
      doc.text(`Status: ${statusLabel} • Entry Date: ${dateStr}`, margin, yPosition);
      yPosition += 6;

      // Thesis
      if (entry.before_buying?.thesis) {
        doc.setTextColor(11, 14, 17);
        doc.setFontSize(10);
        doc.setFont(undefined, 'bold');
        doc.text('Thesis:', margin, yPosition);
        yPosition += 5;

        doc.setFontSize(9);
        doc.setFont(undefined, 'normal');
        const thesisLines = doc.splitTextToSize(entry.before_buying.thesis, maxWidth);
        doc.text(thesisLines, margin, yPosition);
        yPosition += (thesisLines.length * 4) + 3;
      }

      // Confidence
      if (entry.before_buying?.confidence) {
        doc.setTextColor(0, 200, 5);
        doc.setFontSize(9);
        doc.setFont(undefined, 'bold');
        doc.text(`Confidence: ${entry.before_buying.confidence}/10`, margin, yPosition);
        yPosition += 6;
      }

      // Emotional state
      if (entry.before_buying?.emotional_state) {
        doc.setTextColor(100, 116, 139);
        doc.setFontSize(9);
        doc.setFont(undefined, 'normal');
        doc.text(`Emotional State: ${entry.before_buying.emotional_state}`, margin, yPosition);
        yPosition += 6;
      }

      // Key risks
      if (entry.before_buying?.biggest_risks) {
        doc.setTextColor(11, 14, 17);
        doc.setFontSize(10);
        doc.setFont(undefined, 'bold');
        doc.text('Key Risks:', margin, yPosition);
        yPosition += 5;

        doc.setFontSize(9);
        doc.setFont(undefined, 'normal');
        const riskLines = doc.splitTextToSize(entry.before_buying.biggest_risks, maxWidth);
        doc.text(riskLines, margin, yPosition);
        yPosition += (riskLines.length * 4) + 5;
      }

      // Separator
      doc.setDrawColor(30, 37, 48);
      doc.line(margin, yPosition, margin + maxWidth, yPosition);
      yPosition += 8;
    });

    // Footer
    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text(
        `Page ${i} of ${totalPages}`,
        doc.internal.pageSize.getWidth() / 2,
        doc.internal.pageSize.getHeight() - 8,
        { align: 'center' }
      );
    }

    // Save with date in filename (same file overwrites daily)
    const dateStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    doc.save(`PineX-Journal-${dateStr}.pdf`);
  } catch (err) {
    console.error('Failed to export PDF:', err);
  }
};
