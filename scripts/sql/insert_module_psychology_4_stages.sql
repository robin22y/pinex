-- ── Academy Module — "The Psychology of the 4 Market Stages" ─────────
-- Six lessons (intro + 4 stages + mirror exercise) populated in EN +
-- HI + ML + TA. Idempotent: deletes any prior lessons for this
-- module_id before re-inserting, so re-running after a copy-edit
-- replaces cleanly instead of duplicating rows. The module row uses
-- ON CONFLICT (id) DO UPDATE so titles + subtitles can be tweaked
-- via this file later without losing the lesson rows that reference
-- it.
--
-- Schema notes (live academy_modules / academy_lessons):
--   academy_modules:   id text PK + title_<lang> + subtitle_<lang> +
--                      icon + duration + sort_order + is_published +
--                      total_questions + pass_mark. NO content jsonb
--                      column — lesson body lives in academy_lessons.
--   academy_lessons:   uuid PK + module_id FK + sort_order + a
--                      single shared `title` (not per-language) +
--                      content_<lang> + visual_caption_<lang> +
--                      visual_type + is_published.
--
-- Brand / technical terms (PineX, Stage 1/2/3/4, FOMO, RSI, MA,
-- numerical values, ₹ amounts) are intentionally retained in
-- English / transliterated form across every language per the
-- author's note.
--
-- Run in the Supabase SQL editor.

-- ── 1. Module row ────────────────────────────────────────────────
INSERT INTO academy_modules
    (id, sort_order, is_published, total_questions, pass_mark, icon, duration,
     title_en,                                          title_hi,                          title_ml,                                          title_ta,
     subtitle_en,                                       subtitle_hi,                                                          subtitle_ml,                                                                   subtitle_ta)
VALUES
    ('psychology_4_stages', 10, TRUE, 0, 0, '🧠', '8 min',
     'The Psychology of the 4 Market Stages',
     '4 मार्केट स्टेज की साइकोलॉजी',
     '4 മാർക്കറ്റ് ഘട്ടങ്ങളുടെ മനഃശാസ്ത്രം',
     '4 சந்தை நிலைகளின் உளவியல்',
     'Each stage forces a specific emotion. Recognise it. Do the opposite.',
     'हर स्टेज एक खास भावना पैदा करता है। उसे पहचानें। उल्टा करें।',
     'ഓരോ ഘട്ടവും ഒരു പ്രത്യേക വികാരത്തിലേക്ക് നിങ്ങളെ നയിക്കുന്നു. അത് തിരിച്ചറിയുക. നേർവിപരീതം ചെയ്യുക.',
     'ஒவ்வொரு நிலையும் ஒரு குறிப்பிட்ட உணர்ச்சியை உருவாக்குகிறது. அதை அடையாளம் காணுங்கள். எதிர்மறையாகச் செய்யுங்கள்.')
ON CONFLICT (id) DO UPDATE
SET sort_order = EXCLUDED.sort_order,
    is_published = EXCLUDED.is_published,
    total_questions = EXCLUDED.total_questions,
    pass_mark = EXCLUDED.pass_mark,
    icon = EXCLUDED.icon,
    duration = EXCLUDED.duration,
    title_en = EXCLUDED.title_en,
    title_hi = EXCLUDED.title_hi,
    title_ml = EXCLUDED.title_ml,
    title_ta = EXCLUDED.title_ta,
    subtitle_en = EXCLUDED.subtitle_en,
    subtitle_hi = EXCLUDED.subtitle_hi,
    subtitle_ml = EXCLUDED.subtitle_ml,
    subtitle_ta = EXCLUDED.subtitle_ta;

-- ── 2. Wipe existing lessons for this module (idempotent re-run) ──
DELETE FROM academy_lessons WHERE module_id = 'psychology_4_stages';

-- ── 3. Six lessons in EN / HI / ML / TA ──────────────────────────

INSERT INTO academy_lessons
    (module_id, sort_order, title, visual_type, is_published,
     content_en, content_hi, content_ml, content_ta)
VALUES
-- Lesson 1 — Why You're Really Trading Emotions
('psychology_4_stages', 1,
 'Why You''re Really Trading Emotions', 'none', TRUE,
 E'Most traders believe they are trading tickers, volume, and moving averages. They aren''t. They are trading their own emotions.\n\nYou already know the PineX framework: every stock moves through four distinct stages. But what most platforms won''t tell you is that each stage is a psychological trap engineered to make you do the wrong thing at the worst possible time.\n\nUnderstanding market psychology isn''t about deep breathing; it''s about recognising which emotion the current market stage is forcing you to feel — and using PineX data to do the opposite.',
 E'ज़्यादातर ट्रेडर्स को लगता है कि वे टिकर, वॉल्यूम और मूविंग एवरेज पर ट्रेड कर रहे हैं। ऐसा नहीं है। वे अपनी ही भावनाओं पर ट्रेड कर रहे होते हैं।\n\nPineX फ्रेमवर्क के अनुसार, हर स्टॉक चार अलग-अलग स्टेज से गुज़रता है। लेकिन जो बात कोई अन्य प्लेटफ़ॉर्म नहीं बताता, वह यह है कि हर स्टेज एक मनोवैज्ञानिक जाल (Psychological Trap) है, जो आपसे सबसे ग़लत समय पर सबसे ग़लत काम करवाता है।\n\nमार्केट साइकोलॉजी समझने का मतलब गहरी साँसें लेना नहीं है — यह पहचानना है कि मौजूदा मार्केट स्टेज आपको कौन-सी भावना महसूस करवा रहा है, और PineX डेटा का इस्तेमाल करके उसके बिल्कुल उल्टा करना है।',
 E'മിക്ക ട്രേഡർമാരും കരുതുന്നത് അവർ ടിക്കറുകൾക്കും വോളിയത്തിനും മൂവിംഗ് ആവറേജുകൾക്കും അനുസരിച്ച് ട്രേഡ് ചെയ്യുന്നു എന്നാണ്. യഥാർത്ഥത്തിൽ അവർ ട്രേഡ് ചെയ്യുന്നത് സ്വന്തം വികാരങ്ങളെയാണ്.\n\nPineX ഫ്രെയിംവർക്ക് അനുസരിച്ച്, ഓരോ സ്റ്റോക്കും നാല് വ്യത്യസ്ത ഘട്ടങ്ങളിലൂടെ കടന്നുപോകുന്നു. എന്നാൽ മറ്റ് പ്ലാറ്റ്ഫോമുകൾ പറയാത്ത കാര്യം ഇതാണ് — ഓരോ ഘട്ടവും നിങ്ങളെക്കൊണ്ട് ഏറ്റവും തെറ്റായ സമയത്ത് ഏറ്റവും തെറ്റായ കാര്യം ചെയ്യിക്കാൻ രൂപകല്പന ചെയ്ത ഒരു മാനസിക കെണിയാണ് (Psychological Trap).\n\nമാർക്കറ്റ് മനഃശാസ്ത്രം മനസ്സിലാക്കുക എന്നാൽ ദീർഘശ്വാസം എടുക്കൽ അല്ല; നിലവിലെ മാർക്കറ്റ് ഘട്ടം നിങ്ങളെ ഏത് വികാരത്തിലേക്ക് നയിക്കുന്നു എന്ന് തിരിച്ചറിയുകയും PineX ഡാറ്റ ഉപയോഗിച്ച് നേർവിപരീതം ചെയ്യുകയും ആണ്.',
 E'பெரும்பாலான வர்த்தகர்கள் தாங்கள் டிக்கர்கள், வால்யூம் மற்றும் மூவிங் ஆவரேஜ்களை வைத்து ட்ரேட் செய்வதாக நினைக்கிறார்கள். ஆனால் உண்மையில் அவர்கள் தங்கள் சொந்த உணர்ச்சிகளை வைத்துதான் ட்ரேட் செய்கிறார்கள்.\n\nPineX கட்டமைப்பின்படி, ஒவ்வொரு பங்கும் நான்கு வெவ்வேறு நிலைகளைக் கடந்து செல்கிறது. ஆனால் மற்ற தளங்கள் சொல்லாத ஒன்று உள்ளது — ஒவ்வொரு நிலையும், தவறான நேரத்தில் உங்களை தவறான முடிவை எடுக்கத் தூண்டும் ஒரு உளவியல் வலையாக (Psychological Trap) வடிவமைக்கப்பட்டுள்ளது.\n\nமார்க்கெட் உளவியலைப் புரிந்துகொள்வது என்பது ஆழ்ந்த மூச்சு விடுவது அல்ல — தற்போதைய மார்க்கெட் நிலை உங்களை எந்த உணர்ச்சியை உணரத் தூண்டுகிறது என்பதை அடையாளம் கண்டு, PineX தரவுகளைப் பயன்படுத்தி அதற்கு நேர்மாறாகச் செயல்படுவது.'),

-- Lesson 2 — Stage 1: The Trap of Boredom
('psychology_4_stages', 2,
 'Stage 1: The Trap of Boredom', 'none', TRUE,
 E'Stage 1 is where a stock bottoms out and moves sideways. Institutional money is quietly accumulating shares, but the price isn''t making exciting headlines.\n\nThe Dominant Emotion: Extreme boredom and frustration.\n\nThe Trap: "Opportunity Cost." You buy a stock in late Stage 1, but it chops around for weeks. You get frustrated watching other stocks fly, so you sell to chase a green candle elsewhere. Two weeks later, your original stock breaks out into Stage 2 without you.\n\nThe Reality: Boredom is the filter institutions use to shake out impatient retail traders.',
 E'Stage 1 वह दौर है जब स्टॉक तल पर पहुँचकर साइडवेज़ चलता है। संस्थागत निवेशक (Institutions) चुपचाप शेयर जमा कर रहे होते हैं, लेकिन कीमत में कुछ रोमांचक नहीं दिखता।\n\nहावी भावना: अत्यधिक बोरियत और निराशा।\n\nजाल: "Opportunity Cost". आप लेट Stage 1 में स्टॉक ख़रीदते हैं, लेकिन वह हफ़्तों तक वहीं फँसा रहता है। दूसरे स्टॉक्स को उड़ता देख आप बोर होकर उसे बेच देते हैं। दो हफ़्ते बाद, वही स्टॉक आपके बिना Stage 2 में ब्रेकआउट कर देता है।\n\nसच्चाई: बोरियत वह फ़िल्टर है जिसका इस्तेमाल संस्थागत निवेशक उतावले रिटेल ट्रेडर्स को बाहर निकालने के लिए करते हैं।',
 E'Stage 1 എന്നത് സ്റ്റോക്ക് ഏറ്റവും താഴ്ന്ന് സൈഡ്‌വേയ്സ് നീങ്ങുന്ന ഘട്ടമാണ്. സ്ഥാപനങ്ങൾ (Institutions) നിശ്ശബ്ദമായി ഓഹരികൾ ശേഖരിക്കുകയാണ്, പക്ഷേ വിലയിൽ ആവേശകരമായ ഒന്നുമില്ല.\n\nപ്രധാന വികാരം: കടുത്ത ബോറടിയും നിരാശയും.\n\nകെണി: "അവസര നഷ്ടം" (Opportunity Cost). നിങ്ങൾ ലേറ്റ് Stage 1-ൽ ഒരു സ്റ്റോക്ക് വാങ്ങുന്നു, പക്ഷേ അത് ആഴ്ചകളോളം ഒരേ വിലയിൽ തുടരുന്നു. മറ്റ് സ്റ്റോക്കുകൾ കുതിക്കുന്നത് കണ്ട് മടുത്ത് നിങ്ങൾ അത് വിറ്റ് മറ്റൊരു ഗ്രീൻ കാൻഡിലിന് പിന്നാലെ പോകുന്നു. രണ്ടാഴ്ച കഴിയുമ്പോൾ ആ ആദ്യ സ്റ്റോക്ക് നിങ്ങളില്ലാതെ Stage 2-ലേക്ക് ബ്രേക്ക്ഔട്ട് ചെയ്യുന്നു.\n\nയാഥാർത്ഥ്യം: ക്ഷമയില്ലാത്ത റീട്ടെയിൽ ട്രേഡർമാരെ പുറത്താക്കാൻ സ്ഥാപനങ്ങൾ ഉപയോഗിക്കുന്ന ഫിൽറ്ററാണ് ഈ ബോറടി.',
 E'Stage 1 என்பது ஒரு பங்கு கீழ்நிலையை அடைந்து பக்கவாட்டில் நகரும் காலகட்டம். பெரிய நிறுவனங்கள் (Institutions) அமைதியாக பங்குகளை சேமித்து வைக்கின்றன, ஆனால் விலையில் உற்சாகமான எதுவும் தெரியாது.\n\nஆதிக்கம் செலுத்தும் உணர்ச்சி: கடுமையான சலிப்பு மற்றும் விரக்தி.\n\nவலை: "வாய்ப்புச் செலவு" (Opportunity Cost). லேட் Stage 1-ல் ஒரு பங்கை நீங்கள் வாங்குகிறீர்கள், ஆனால் அது வாரக் கணக்கில் நகராமல் இருக்கிறது. மற்ற பங்குகள் உயருவதைப் பார்த்து சலிப்படைந்து நீங்கள் அதை விற்று வேறொரு பச்சை மெழுகுவர்த்தியைத் துரத்துகிறீர்கள். இரண்டு வாரங்களுக்குப் பிறகு, அந்த முதல் பங்கு உங்களை விட்டு விட்டு Stage 2-க்குச் செல்கிறது.\n\nஉண்மை: பொறுமையற்ற ரீடெய்ல் வர்த்தகர்களை வெளியேற்ற பெரிய நிறுவனங்கள் பயன்படுத்தும் வடிகட்டியே இந்த சலிப்பு.'),

-- Lesson 3 — Stage 2: The Trap of Invincibility
('psychology_4_stages', 3,
 'Stage 2: The Trap of Invincibility', 'none', TRUE,
 E'This is the breakout. The stock is making higher highs and higher lows. The 30-week moving average is sloping up.\n\nThe Dominant Emotion: Euphoria, Greed, and FOMO (Fear of Missing Out).\n\nThe Trap: "Sizing Up at the Top." Because your early Stage 2 trades worked perfectly, you feel invincible. You decide to double or triple your position size right as the trend reaches exhaustion. You buy the late-stage breakout, completely unaware that the PineX market breadth data is already narrowing — meaning fewer stocks are actually participating in the rally, even though your specific stock looks fine.\n\nThe Reality: The easiest time to make money is early Stage 2. The easiest time to set yourself up for ruin is late Stage 2.',
 E'यह ब्रेकआउट का दौर है। स्टॉक हायर हाई और हायर लो बना रहा होता है। 30-वीक मूविंग एवरेज ऊपर की ओर झुक रहा होता है।\n\nहावी भावना: उत्साह, लालच और FOMO (Fear of Missing Out)।\n\nजाल: "टॉप पर पोज़िशन बढ़ाना"। शुरुआती Stage 2 ट्रेड्स में मुनाफ़ा होने से आपको लगता है कि आप कभी ग़लत नहीं हो सकते। जैसे ही ट्रेंड थकने वाला होता है, आप अपनी पोज़िशन दोगुनी या तिगुनी कर देते हैं। आप इस बात से अनजान रहते हैं कि PineX पर मार्केट ब्रेथ (Breadth) डेटा सिकुड़ रहा है — यानी रैली में कम स्टॉक्स भाग ले रहे हैं, भले ही आपका वाला स्टॉक ठीक दिख रहा हो।\n\nसच्चाई: पैसा बनाने का सबसे आसान समय early Stage 2 है, और ख़ुद को बर्बाद करने का सबसे आसान समय late Stage 2 है।',
 E'ഇത് ബ്രേക്ക്ഔട്ടിന്റെ ഘട്ടമാണ്. സ്റ്റോക്ക് ഹയർ ഹൈകളും ഹയർ ലോകളും ഉണ്ടാക്കുന്നു. 30-ആഴ്ച മൂവിംഗ് ആവറേജ് മുകളിലേക്ക് ചരിയുന്നു.\n\nപ്രധാന വികാരം: ആവേശം, അത്യാഗ്രഹം, FOMO (Fear of Missing Out).\n\nകെണി: "ഉച്ചസ്ഥായിയിൽ പൊസിഷൻ വർധിപ്പിക്കൽ". നേരത്തെയുള്ള Stage 2 ട്രേഡുകൾ പൂർണ്ണമായി വിജയിച്ചതിനാൽ നിങ്ങൾക്ക് അജയ്യൻ ആണെന്ന തോന്നൽ വരുന്നു. ട്രെൻഡ് ക്ഷീണിക്കാറാകുമ്പോൾ നിങ്ങൾ പൊസിഷൻ ഇരട്ടിയോ മൂന്നിരട്ടിയോ ആക്കുന്നു. PineX-ലെ മാർക്കറ്റ് ബ്രെഡ്ത് (Breadth) ഡാറ്റ ചുരുങ്ങുകയാണെന്ന് — അതായത് റാലിയിൽ കുറച്ച് സ്റ്റോക്കുകൾ മാത്രമേ പങ്കെടുക്കുന്നുള്ളൂ എന്ന് — നിങ്ങൾ ശ്രദ്ധിക്കുന്നില്ല, നിങ്ങളുടെ പ്രത്യേക സ്റ്റോക്ക് നന്നായി കാണപ്പെടുന്നുണ്ടെങ്കിലും.\n\nയാഥാർത്ഥ്യം: ലാഭമുണ്ടാക്കാൻ ഏറ്റവും എളുപ്പമുള്ള സമയം early Stage 2 ആണ്. നഷ്ടത്തിലേക്ക് വീഴാൻ ഏറ്റവും എളുപ്പമുള്ള സമയം late Stage 2 ആണ്.',
 E'இது ப்ரேக்அவுட் காலகட்டம். பங்கு ஹையர் ஹை மற்றும் ஹையர் லோ உருவாக்குகிறது. 30-வார மூவிங் ஆவரேஜ் மேல்நோக்கி சாய்கிறது.\n\nஆதிக்கம் செலுத்தும் உணர்ச்சி: உற்சாகம், பேராசை மற்றும் FOMO (Fear of Missing Out).\n\nவலை: "உச்சத்தில் முதலீட்டை அதிகரிப்பது". உங்களின் ஆரம்பகட்ட Stage 2 ட்ரேடுகள் வெற்றியடைந்ததால், நீங்கள் தோற்கடிக்க முடியாதவர் போல் உணர்கிறீர்கள். ட்ரெண்ட் முடிவடையும் தருவாயில், உங்கள் முதலீட்டை இரட்டிப்பு அல்லது மூன்று மடங்காக அதிகரிக்கிறீர்கள். PineX-ல் Market Breadth தரவு குறைந்து வருவதை — அதாவது ராலியில் குறைவான பங்குகளே பங்கேற்கின்றன என்பதை — நீங்கள் கவனிக்கத் தவறுகிறீர்கள், உங்கள் குறிப்பிட்ட பங்கு நன்றாக இருக்கிறது என்றாலும்.\n\nஉண்மை: பணம் சம்பாதிக்க மிகவும் எளிதான நேரம் early Stage 2. பணத்தை இழக்க மிகவும் எளிதான நேரம் late Stage 2.'),

-- Lesson 4 — Stage 3: The Trap of Anchoring
('psychology_4_stages', 4,
 'Stage 3: The Trap of Anchoring', 'none', TRUE,
 E'The advance stalls. Volatility increases. The stock chops violently sideways. Institutional money is now distributing (selling) their shares to retail traders who are late to the party.\n\nThe Dominant Emotion: Denial and confusion.\n\nThe Trap: "Anchoring." You remember the stock was just at ₹1,000. Now it''s at ₹850. You anchor your brain to that ₹1,000 price tag and convince yourself ₹850 is a "discount," completely ignoring the heavy volume distribution days on your PineX chart.\n\nThe Reality: A broken trend is not a discount. It is a warning.',
 E'तेज़ी रुक जाती है। उतार-चढ़ाव बढ़ जाता है। स्टॉक तेज़ी से साइडवेज़ झूलता है। संस्थागत निवेशक अब अपने शेयर उन रिटेल ट्रेडर्स को बेच (distribute कर) रहे होते हैं, जो देर से पार्टी में आए हैं।\n\nहावी भावना: इनकार (Denial) और भ्रम।\n\nजाल: "एंकरिंग"। आपको याद रहता है कि स्टॉक अभी ₹1,000 पर था। अब वह ₹850 पर है। आपका दिमाग़ ₹1,000 के भाव पर अटका रहता है और आप ₹850 को "डिस्काउंट" मान लेते हैं, जबकि PineX चार्ट पर भारी डिस्ट्रिब्यूशन दिख रहा होता है।\n\nसच्चाई: टूटा हुआ ट्रेंड कोई डिस्काउंट नहीं, बल्कि एक चेतावनी है।',
 E'മുന്നേറ്റം നിശ്ചലമാകുന്നു. ചാഞ്ചാട്ടം വർദ്ധിക്കുന്നു. സ്റ്റോക്ക് കടുപ്പത്തിൽ സൈഡ്‌വേയ്സ് ആടുന്നു. സ്ഥാപനങ്ങൾ ഇപ്പോൾ വൈകി പാർട്ടിയിലെത്തിയ റീട്ടെയിൽ ട്രേഡർമാർക്ക് അവരുടെ ഓഹരികൾ വിതരണം (distribute) ചെയ്യുകയാണ്.\n\nപ്രധാന വികാരം: നിഷേധിക്കലും (Denial) ആശയക്കുഴപ്പവും.\n\nകെണി: "ആങ്കറിംഗ്". സ്റ്റോക്കിന് ₹1,000 ആയിരുന്നുവെന്ന് നിങ്ങൾ ഓർക്കുന്നു. ഇപ്പോൾ അത് ₹850 ആണ്. നിങ്ങളുടെ മനസ്സ് ₹1,000 എന്ന വിലയിൽ ഉറയ്ക്കുന്നു, ₹850 ഒരു "ഡിസ്കൗണ്ട്" ആണെന്ന് സ്വയം വിശ്വസിപ്പിക്കുന്നു — PineX ചാർട്ടിലെ കനത്ത വോളിയം ഡിസ്ട്രിബ്യൂഷൻ ദിവസങ്ങൾ പൂർണ്ണമായും അവഗണിച്ച്.\n\nയാഥാർത്ഥ്യം: തകർന്ന ഒരു ട്രെൻഡ് ഡിസ്കൗണ്ട് അല്ല. അതൊരു മുന്നറിയിപ്പാണ്.',
 E'மேல்நோக்கிய நகர்வு நிற்கிறது. நிலையற்ற தன்மை அதிகரிக்கிறது. பங்கு கடுமையாக பக்கவாட்டில் ஆடுகிறது. பெரிய நிறுவனங்கள் இப்போது தாமதமாக வந்த ரீடெய்ல் வர்த்தகர்களுக்கு தங்கள் பங்குகளை விற்கிறார்கள் (distribute செய்கிறார்கள்).\n\nஆதிக்கம் செலுத்தும் உணர்ச்சி: மறுப்பு (Denial) மற்றும் குழப்பம்.\n\nவலை: "ஆங்கரிங்". பங்கின் விலை ₹1,000 ஆக இருந்ததை நீங்கள் நினைவில் வைத்திருக்கிறீர்கள். இப்போது அது ₹850-ல் உள்ளது. உங்கள் மனம் ₹1,000 என்ற விலையில் நிலைத்துவிட, ₹850-ஐ ஒரு "டிஸ்கவுண்ட்" என நீங்களே சமாதானம் செய்துகொள்கிறீர்கள் — PineX சார்ட்டில் உள்ள கடுமையான வால்யூம் டிஸ்ட்ரிபியூஷன் நாட்களை முற்றிலும் புறக்கணித்து.\n\nஉண்மை: உடைந்த ட்ரெண்ட் ஒரு டிஸ்கவுண்ட் அல்ல. அது ஒரு எச்சரிக்கை.'),

-- Lesson 5 — Stage 4: The Trap of Paralysis
('psychology_4_stages', 5,
 'Stage 4: The Trap of Paralysis', 'none', TRUE,
 E'The support breaks. The stock begins a brutal sequence of lower lows and lower highs. The moving average rolls over and acts as heavy resistance.\n\nThe Dominant Emotion: Hope and paralysing fear.\n\nThe Trap: "The Involuntary Long-Term Investor." Taking a small 8% loss hurts your ego, so you refuse to sell. As the loss grows to 20%, 40%, and 60%, you freeze. You stop looking at your portfolio and start hoping for a miracle bounce just to break even.\n\nThe Reality: Hope is not a trading strategy. Stage 4 is where accounts go to die.',
 E'सपोर्ट टूट जाता है। स्टॉक लोअर लो और लोअर हाई की क्रूर श्रृंखला शुरू कर देता है। मूविंग एवरेज पलट जाता है और भारी रेज़िस्टेंस की तरह काम करता है।\n\nहावी भावना: उम्मीद और लकवा मार देने वाला डर।\n\nजाल: "मजबूर लॉन्ग-टर्म इन्वेस्टर"। 8% का छोटा नुक़सान बुक करने में आपका ईगो आहत होता है, इसलिए आप बेचने से इनकार कर देते हैं। जब नुक़सान 20%, 40% और 60% तक बढ़ जाता है, तो आप सुन्न हो जाते हैं। आप पोर्टफ़ोलियो देखना बंद कर देते हैं और बस ब्रेक-ईवन के लिए किसी चमत्कारी बाउंस की उम्मीद करने लगते हैं।\n\nसच्चाई: उम्मीद कोई ट्रेडिंग स्ट्रेटेजी नहीं है। Stage 4 वह जगह है जहाँ ट्रेडिंग अकाउंट ख़त्म होते हैं।',
 E'സപ്പോർട്ട് തകരുന്നു. സ്റ്റോക്ക് ലോവർ ലോകളും ലോവർ ഹൈകളും തുടരുന്ന ക്രൂരമായ ഒരു ശ്രേണി ആരംഭിക്കുന്നു. മൂവിംഗ് ആവറേജ് മറിയുകയും കനത്ത റെസിസ്റ്റൻസ് ആയി പ്രവർത്തിക്കുകയും ചെയ്യുന്നു.\n\nപ്രധാന വികാരം: പ്രതീക്ഷയും തളർത്തുന്ന ഭയവും.\n\nകെണി: "നിർബന്ധിത ലോംഗ്-ടേം ഇൻവെസ്റ്റർ" (Involuntary Long-Term Investor). 8% എന്ന ചെറിയ നഷ്ടം അംഗീകരിക്കാൻ നിങ്ങളുടെ ഈഗോ സമ്മതിക്കാത്തതിനാൽ നിങ്ങൾ വിൽക്കാൻ വിസമ്മതിക്കുന്നു. നഷ്ടം 20%, 40%, 60% ആയി വളരുമ്പോൾ നിങ്ങൾ മരവിച്ചുപോകുന്നു. പോർട്ട്ഫോളിയോ നോക്കുന്നത് നിർത്തി, ബ്രേക്ക്-ഈവൻ ആകാൻ ഒരു അത്ഭുത ബൗൺസ് നടക്കുമെന്ന് നിങ്ങൾ പ്രതീക്ഷിക്കാൻ തുടങ്ങുന്നു.\n\nയാഥാർത്ഥ്യം: പ്രതീക്ഷ ഒരു ട്രേഡിംഗ് തന്ത്രമല്ല. അക്കൗണ്ടുകൾ ഇല്ലാതാകുന്ന ഇടം Stage 4 ആണ്.',
 E'சப்போர்ட் உடைகிறது. பங்கு லோவர் லோ மற்றும் லோவர் ஹை-ன் கடினமான வரிசையைத் தொடங்குகிறது. மூவிங் ஆவரேஜ் கீழ்நோக்கி திரும்பி கடுமையான ரெசிஸ்டன்ஸாக செயல்படுகிறது.\n\nஆதிக்கம் செலுத்தும் உணர்ச்சி: எதிர்பார்ப்பு மற்றும் முடக்கும் பயம்.\n\nவலை: "கட்டாய நீண்ட கால முதலீட்டாளர்" (Involuntary Long-Term Investor). 8% சிறிய நஷ்டத்தை ஏற்க உங்கள் ஈகோ அனுமதிக்காததால் நீங்கள் விற்க மறுக்கிறீர்கள். அந்த நஷ்டம் 20%, 40%, 60% என வளரும்போது நீங்கள் உறைந்துபோகிறீர்கள். போர்ட்ஃபோலியோவைப் பார்ப்பதை நிறுத்திவிட்டு, ப்ரேக்-ஈவன் ஆக ஒரு அதிசய பவுன்ஸ் நடக்கும் என எதிர்பார்க்கத் தொடங்குகிறீர்கள்.\n\nஉண்மை: எதிர்பார்ப்பு என்பது வர்த்தக உத்தி அல்ல. கணக்குகள் காலியாகும் இடம் Stage 4.'),

-- Lesson 6 — The PineX Mirror Exercise
('psychology_4_stages', 6,
 'The PineX Mirror Exercise', 'none', TRUE,
 E'Don''t just take our word for it. Let''s look at the data right now.\n\n→ Open the PineX Screener.\n→ Filter the database for stocks currently in Stage 4.\n→ Look at the charts.\n\nNotice how many of those charts look like a slow-motion disaster. Six to twelve months ago, the crowd was furiously buying those exact same stocks in late Stage 2 or Stage 3, convinced they would go up forever.\n\nThat is not hindsight. That is Stage Analysis. You now have the language to see the trap before the crowd falls into it.',
 E'सिर्फ़ हमारी बात पर भरोसा न करें। चलिए, अभी डेटा देखते हैं।\n\n→ PineX Screener खोलें।\n→ वर्तमान में Stage 4 में मौजूद स्टॉक्स को फ़िल्टर करें।\n→ उनके चार्ट्स देखें।\n\nध्यान दें कि वे चार्ट्स कैसे एक स्लो-मोशन आपदा की तरह दिखते हैं। छह से बारह महीने पहले, यही भीड़ इन्हीं स्टॉक्स को late Stage 2 या Stage 3 में जोश के साथ ख़रीद रही थी — इस यक़ीन के साथ कि ये हमेशा ऊपर जाएंगे।\n\nयह hindsight नहीं है, यह Stage Analysis है। अब आपके पास उस जाल को भीड़ से पहले देखने की भाषा है।',
 E'ഞങ്ങൾ പറയുന്നത് മാത്രം വിശ്വസിക്കരുത്. ഇപ്പോൾ തന്നെ ഡാറ്റ നോക്കാം.\n\n→ PineX Screener തുറക്കുക.\n→ ഇപ്പോൾ Stage 4-ൽ ഉള്ള സ്റ്റോക്കുകൾ ഫിൽറ്റർ ചെയ്യുക.\n→ ചാർട്ടുകൾ നോക്കുക.\n\nആ ചാർട്ടുകൾ എങ്ങനെ ഒരു സ്ലോ-മോഷൻ ദുരന്തം പോലെ കാണപ്പെടുന്നുവെന്ന് ശ്രദ്ധിക്കുക. ആറുമുതൽ പന്ത്രണ്ടു മാസം മുമ്പ്, ഇതേ ജനക്കൂട്ടം ഇതേ സ്റ്റോക്കുകൾ late Stage 2-ലോ Stage 3-ലോ ആവേശത്തോടെ വാങ്ങുകയായിരുന്നു — അവ എന്നും ഉയരും എന്ന ഉറപ്പിൽ.\n\nഇത് കഴിഞ്ഞശേഷം പറയുന്ന വിശകലനമല്ല, ഇതാണ് Stage Analysis. ജനക്കൂട്ടം ആ കെണിയിൽ വീഴുന്നതിന് മുമ്പ് അത് കാണാനുള്ള ഭാഷ ഇപ്പോൾ നിങ്ങൾക്കുണ്ട്.',
 E'எங்கள் வார்த்தையை மட்டும் நம்ப வேண்டாம். தற்போதே தரவைப் பார்ப்போம்.\n\n→ PineX Screener-ஐ திறக்கவும்.\n→ தற்போது Stage 4-ல் உள்ள பங்குகளை ஃபில்டர் செய்யவும்.\n→ அதன் சார்ட்டுகளைப் பார்க்கவும்.\n\nஅந்த சார்ட்டுகள் எப்படி ஒரு மெதுவான பேரழிவாகத் தெரிகின்றன என்பதைக் கவனியுங்கள். ஆறு முதல் பன்னிரண்டு மாதங்களுக்கு முன்பு, இதே கூட்டம் இதே பங்குகளை late Stage 2 அல்லது Stage 3-ல் உற்சாகத்துடன் வாங்கிக் கொண்டிருந்தது — அவை எப்போதும் மேலே போகும் என்ற நம்பிக்கையில்.\n\nஇது நடந்து முடிந்த பிறகு சொல்வது அல்ல, இதுதான் Stage Analysis. மற்றவர்கள் அந்த வலையில் விழுவதற்கு முன்பு அதைப் பார்க்கும் மொழி இப்போது உங்களிடம் உள்ளது.');
