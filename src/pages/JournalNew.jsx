import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { createEntry } from '../lib/journal';

const colors = {
  bg: 'var(--bg-primary)',
  surface: 'var(--bg-surface)',
  card: 'var(--bg-elevated)',
  border: 'var(--border)',
  text: 'var(--text-primary)',
  muted: 'var(--text-muted)',
  green: 'var(--positive)',
  red: 'var(--negative)',
  blue: 'var(--info)',
  amber: 'var(--warning)'
};

const emotionalStates = ['Calm', 'Excited', 'Fear of Missing Out', 'Revenge Trade', 'Recovering Losses', 'Not Sure'];

export default function JournalNew() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    ticker: '',
    company_name: '',
    status: 'watching',
    entry_date: new Date().toISOString().split('T')[0],
    before_buying: {
      avg_price: '',
      position_size: '',
      max_allocation: '',
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
      emotional_state: 'Calm',
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
    }
  });

  const updateField = (path, value) => {
    const keys = path.split('.');
    setFormData(prev => {
      const newData = JSON.parse(JSON.stringify(prev));
      let current = newData;
      for (let i = 0; i < keys.length - 1; i++) {
        current = current[keys[i]];
      }
      current[keys[keys.length - 1]] = value;
      return newData;
    });
  };

  const canProceedStep2 = () => {
    return formData.before_buying.why_i_might_be_wrong.trim().length > 0 &&
           formData.before_buying.bear_case.trim().length > 0;
  };

  const handleSave = () => {
    createEntry(formData);
    navigate('/journal');
  };

  const header = (title, canGoBack = true) => (
    <div style={{
      padding: '16px',
      borderBottom: `1px solid ${colors.border}`,
      display: 'flex',
      alignItems: 'center',
      gap: '12px'
    }}>
      {canGoBack && (
        <button
          onClick={() => step === 1 ? navigate('/journal') : setStep(step - 1)}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: colors.text,
            padding: '4px'
          }}
        >
          <ChevronLeft size={20} />
        </button>
      )}
      <h1 style={{ fontSize: '18px', fontWeight: 600, margin: 0 }}>{title}</h1>
    </div>
  );

  const textInput = (label, path, required = false) => {
    const value = path.split('.').reduce((obj, key) => obj[key], formData);
    return (
      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: colors.text }}>
          {label} {required && <span style={{ color: colors.red }}>*</span>}
        </label>
        <input
          type="text"
          value={value}
          onChange={(e) => updateField(path, e.target.value)}
          style={{
            width: '100%',
            padding: '10px',
            backgroundColor: colors.card,
            border: `1px solid ${colors.border}`,
            borderRadius: '6px',
            color: colors.text,
            fontSize: '14px',
            boxSizing: 'border-box'
          }}
        />
      </div>
    );
  };

  const tickerInput = (label, required = false) => {
    return (
      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: colors.text }}>
          {label} {required && <span style={{ color: colors.red }}>*</span>}
        </label>
        <input
          type="text"
          value={formData.ticker}
          onChange={(e) => {
            const upperTicker = e.target.value.toUpperCase();
            updateField('ticker', upperTicker);
          }}
          placeholder="e.g., INFY, TCS, RELIANCE"
          style={{
            width: '100%',
            padding: '10px',
            backgroundColor: colors.card,
            border: `1px solid ${colors.border}`,
            borderRadius: '6px',
            color: colors.text,
            fontSize: '14px',
            boxSizing: 'border-box',
            textTransform: 'uppercase'
          }}
        />
      </div>
    );
  };

  const textArea = (label, path, required = false, rows = 3) => {
    const value = path.split('.').reduce((obj, key) => obj[key], formData);
    return (
      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: colors.text }}>
          {label} {required && <span style={{ color: colors.red }}>*</span>}
        </label>
        <textarea
          value={value}
          onChange={(e) => updateField(path, e.target.value)}
          rows={rows}
          style={{
            width: '100%',
            padding: '10px',
            backgroundColor: colors.card,
            border: `1px solid ${colors.border}`,
            borderRadius: '6px',
            color: colors.text,
            fontSize: '14px',
            fontFamily: 'inherit',
            boxSizing: 'border-box',
            resize: 'vertical'
          }}
        />
      </div>
    );
  };

  const slider = (label, path) => {
    const value = path.split('.').reduce((obj, key) => obj[key], formData);
    return (
      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '8px', color: colors.text }}>
          {label}: <span style={{ color: colors.green, fontWeight: 700 }}>{value}/10</span>
        </label>
        <input
          type="range"
          min="1"
          max="10"
          value={value}
          onChange={(e) => updateField(path, parseInt(e.target.value))}
          style={{ width: '100%' }}
        />
      </div>
    );
  };

  const checkbox = (label, path) => {
    const value = path.split('.').reduce((obj, key) => obj[key], formData);
    return (
      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', cursor: 'pointer', fontSize: '14px' }}>
        <input
          type="checkbox"
          checked={value}
          onChange={(e) => updateField(path, e.target.checked)}
          style={{ cursor: 'pointer', width: '16px', height: '16px' }}
        />
        <span style={{ color: colors.text }}>{label}</span>
      </label>
    );
  };

  const select = (label, path, options) => {
    const value = path.split('.').reduce((obj, key) => obj[key], formData);
    return (
      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: colors.text }}>
          {label}
        </label>
        <select
          value={value}
          onChange={(e) => updateField(path, e.target.value)}
          style={{
            width: '100%',
            padding: '10px',
            backgroundColor: colors.card,
            border: `1px solid ${colors.border}`,
            borderRadius: '6px',
            color: colors.text,
            fontSize: '14px'
          }}
        >
          {options.map(opt => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      </div>
    );
  };

  return (
    <div style={{ backgroundColor: colors.bg, minHeight: '100vh', paddingBottom: '60px' }}>
      <style>{`html, body { background: ${colors.bg} !important; color: ${colors.text} !important; }`}</style>

      {step === 1 && (
        <>
          {header('New Entry — Step 1 of 3')}
          <div style={{ padding: '16px' }}>
            {tickerInput('Ticker (Symbol)', true)}
            {textInput('Company Name', 'company_name', true)}
            {select('Status', 'status', ['watching', 'owned', 'sold'])}
            {textInput('Entry Date', 'entry_date')}

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => setStep(2)}
                style={{
                  flex: 1,
                  padding: '12px',
                  backgroundColor: colors.green,
                  color: colors.bg,
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Continue
              </button>
            </div>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          {header('New Entry — Step 2 of 3')}
          <div style={{ padding: '16px' }}>
            {textArea('Investment Thesis', 'before_buying.thesis', false, 2)}
            {textArea('Fundamental Reasons', 'before_buying.fundamental_reasons', false, 2)}
            {textArea('Technical Reasons', 'before_buying.technical_reasons', false, 2)}
            {textArea('Expected Catalysts', 'before_buying.expected_catalysts', false, 2)}
            {textArea('Biggest Risks', 'before_buying.biggest_risks', false, 2)}
            {textArea('What Must Go Right', 'before_buying.what_must_go_right', false, 2)}
            {textArea('Conditions to Sell', 'before_buying.conditions_to_sell', false, 2)}

            <div style={{
              padding: '12px',
              backgroundColor: colors.card,
              border: `1px solid ${colors.border}`,
              borderRadius: '6px',
              marginBottom: '16px'
            }}>
              <div style={{ fontSize: '12px', color: colors.amber, marginBottom: '8px', fontWeight: 600 }}>
                ⚠ REQUIRED
              </div>
              {textArea('Convince Yourself NOT to Buy', 'before_buying.why_i_might_be_wrong', true, 3)}
            </div>

            <div style={{
              padding: '12px',
              backgroundColor: colors.card,
              border: `1px solid ${colors.border}`,
              borderRadius: '6px',
              marginBottom: '16px'
            }}>
              <div style={{ fontSize: '12px', color: colors.amber, marginBottom: '8px', fontWeight: 600 }}>
                ⚠ REQUIRED
              </div>
              {textArea('Strongest Argument Against This', 'before_buying.bear_case', true, 3)}
            </div>

            {slider('Confidence', 'before_buying.confidence')}
            {select('Emotional State', 'before_buying.emotional_state', emotionalStates)}

            <div style={{
              padding: '12px',
              backgroundColor: colors.card,
              border: `1px solid ${colors.border}`,
              borderRadius: '6px',
              marginBottom: '16px'
            }}>
              <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '12px', color: colors.text }}>
                Pre-Entry Checklist
              </div>
              {checkbox('Position sizing planned', 'before_buying.checklist.position_sizing')}
              {checkbox('Understand downside', 'before_buying.checklist.understand_downside')}
              {checkbox('Read latest earnings', 'before_buying.checklist.read_earnings')}
              {checkbox('Checked dilution', 'before_buying.checklist.checked_dilution')}
              {checkbox('Checked insider holdings', 'before_buying.checklist.checked_insider')}
              {checkbox('Checked short report', 'before_buying.checklist.checked_short_report')}
              {checkbox('Verified CEO track record', 'before_buying.checklist.checked_ceo')}
              {checkbox('Checked competitors', 'before_buying.checklist.checked_competitors')}
              {checkbox('Understand catalysts', 'before_buying.checklist.understand_catalysts')}
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => setStep(1)}
                style={{
                  flex: 1,
                  padding: '12px',
                  backgroundColor: colors.card,
                  border: `1px solid ${colors.border}`,
                  borderRadius: '6px',
                  color: colors.text,
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Back
              </button>
              <button
                onClick={() => setStep(3)}
                disabled={!canProceedStep2()}
                style={{
                  flex: 1,
                  padding: '12px',
                  backgroundColor: canProceedStep2() ? colors.green : colors.muted,
                  color: colors.bg,
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: canProceedStep2() ? 'pointer' : 'not-allowed',
                  opacity: canProceedStep2() ? 1 : 0.5
                }}
              >
                Review
              </button>
            </div>
          </div>
        </>
      )}

      {step === 3 && (
        <>
          {header('Confirm Entry')}
          <div style={{ padding: '16px' }}>
            <div style={{
              padding: '16px',
              backgroundColor: colors.card,
              border: `1px solid ${colors.border}`,
              borderRadius: '8px',
              marginBottom: '16px'
            }}>
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '12px', color: colors.muted, marginBottom: '4px' }}>Ticker</div>
                <div style={{ fontSize: '16px', fontWeight: 600, color: colors.text }}>{formData.ticker}</div>
              </div>
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '12px', color: colors.muted, marginBottom: '4px' }}>Company</div>
                <div style={{ fontSize: '14px', color: colors.text }}>{formData.company_name}</div>
              </div>
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '12px', color: colors.muted, marginBottom: '4px' }}>Status</div>
                <div style={{ fontSize: '14px', color: colors.text, textTransform: 'capitalize' }}>{formData.status}</div>
              </div>
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '12px', color: colors.muted, marginBottom: '4px' }}>Confidence</div>
                <div style={{ fontSize: '14px', color: colors.green, fontWeight: 600 }}>{formData.before_buying.confidence}/10</div>
              </div>
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '12px', color: colors.muted, marginBottom: '4px' }}>Emotional State</div>
                <div style={{ fontSize: '14px', color: colors.text }}>{formData.before_buying.emotional_state}</div>
              </div>
              <div>
                <div style={{ fontSize: '12px', color: colors.muted, marginBottom: '4px' }}>Thesis</div>
                <div style={{ fontSize: '13px', color: colors.text, lineHeight: '1.4' }}>
                  {formData.before_buying.thesis || '(Not provided)'}
                </div>
              </div>
            </div>

            <div style={{
              padding: '12px',
              backgroundColor: colors.card,
              border: `1px solid ${colors.blue}`,
              borderRadius: '6px',
              marginBottom: '16px',
              fontSize: '12px',
              color: colors.blue
            }}>
              ℹ This entry is saved only to your device. Backup regularly to keep your data safe.
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => setStep(2)}
                style={{
                  flex: 1,
                  padding: '12px',
                  backgroundColor: colors.card,
                  border: `1px solid ${colors.border}`,
                  borderRadius: '6px',
                  color: colors.text,
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Edit
              </button>
              <button
                onClick={handleSave}
                style={{
                  flex: 1,
                  padding: '12px',
                  backgroundColor: colors.green,
                  color: colors.bg,
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Save Entry
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
