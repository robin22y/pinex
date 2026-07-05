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
  after_selling: {
    date_sold: null,
    avg_exit: null,
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
  }
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
