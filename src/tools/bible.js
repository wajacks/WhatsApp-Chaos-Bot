const API_BASE = 'https://bible.helloao.org/api';

let translationsCache = null;
const booksCache = new Map();

const normalize = value =>
    String(value).toLowerCase().replace(/[^a-z0-9]/g, '');

function parseReference(reference) {
    const match = reference.trim().match(/^(.+?)\s+(\d+):(\d+)(?:-(\d+))?$/);
    if (!match) return null;

    return {
        book: match[1].trim(),
        chapter: Number(match[2]),
        startVerse: Number(match[3]),
        endVerse: Number(match[4] || match[3])
    };
}

async function getTranslations() {
    if (translationsCache) return translationsCache;

    const response = await fetch(`${API_BASE}/available_translations.json`);

    if (!response.ok) {
        throw new Error(`Translation request failed: ${response.status}`);
    }

    const data = await response.json();
    translationsCache = data.translations || [];

    return translationsCache;
}

function findTranslation(translations, language) {
    const matches = translations.filter(t => {
        const value =
            `${t.language} ${t.languageName} ${t.languageEnglishName}`.toLowerCase();

        if (language === 'english') {
            return t.language === 'eng' || value.includes('english');
        }

        if (language === 'swahili') {
            return t.language === 'swa' || value.includes('swahili');
        }

        return false;
    });

    return matches
        .filter(t => Number(t.numberOfBooks || 0) >= 66)
        .sort((a, b) => {
            if (language === 'english') {
                if (a.id === 'BSB') return -1;
                if (b.id === 'BSB') return 1;
            }

            return 0;
        })[0] || matches[0] || null;
}

async function getBooks(translationId) {
    if (booksCache.has(translationId)) {
        return booksCache.get(translationId);
    }

    const response = await fetch(
        `${API_BASE}/${translationId}/books.json`
    );

    if (!response.ok) {
        throw new Error(`Book request failed: ${response.status}`);
    }

    const data = await response.json();
    const books = data.books || [];

    booksCache.set(translationId, books);

    return books;
}

function findBook(books, input) {
  const wanted = normalize(input);

  // English → Kiswahili book-name aliases
  const swahiliAliases = {
      genesis: 'mwanzo',
      exodus: 'kutoka',
      leviticus: 'walawi',
      numbers: 'hesabu',
      deuteronomy: 'kumbukumbuletorati',
      joshua: 'yoshua',
      judges: 'waamuzi',
      ruth: 'ruthu',
      '1samuel': '1samweli',
      '2samuel': '2samweli',
      '1kings': '1wafalme',
      '2kings': '2wafalme',
      '1chronicles': '1mamboyanyakati',
      '2chronicles': '2mamboyanyakati',
      ezra: 'ezra',
      nehemiah: 'nehemia',
      esther: 'esta',
      job: 'ayubu',
      psalms: 'zaburi',
      proverbs: 'mithali',
      ecclesiastes: 'mhubiri',
      songofsolomon: 'wimbouliobora',
      songofsongs: 'wimbouliobora',
      isaiah: 'isaya',
      jeremiah: 'yeremia',
      lamentations: 'maombolezo',
      ezekiel: 'ezekieli',
      daniel: 'danieli',
      hosea: 'hosea',
      joel: 'yoeli',
      amos: 'amos',
      obadiah: 'obadia',
      jonah: 'yona',
      micah: 'mika',
      nahum: 'nahumu',
      habakkuk: 'habakuki',
      zephaniah: 'sefania',
      haggai: 'hagai',
      zechariah: 'zekaria',
      malachi: 'malaki',

      matthew: 'mathayo',
      mark: 'marko',
      luke: 'luka',
      john: 'yohana',
      acts: 'matendoyamitume',
      romans: 'warumi',
      '1corinthians': '1wakorintho',
      '2corinthians': '2wakorintho',
      galatians: 'wagalatia',
      ephesians: 'waefeso',
      philippians: 'wafilipi',
      colossians: 'wakolosai',
      '1thessalonians': '1wathesalonike',
      '2thessalonians': '2wathesalonike',
      '1timothy': '1timotheo',
      '2timothy': '2timotheo',
      titus: 'tito',
      philemon: 'filemoni',
      hebrews: 'waebrania',
      james: 'yakobo',
      '1peter': '1petro',
      '2peter': '2petro',
      '1john': '1yohana',
      '2john': '2yohana',
      '3john': '3yohana',
      jude: 'yuda',
      revelation: 'ufunuo'
  };

  // Common alternative English spellings
  const englishAliases = {
      songsofsolomon: 'songofsolomon',
      songofsolomon: 'songofsolomon',
      canticles: 'songofsolomon',

      psalm: 'psalms',

      '1sam': '1samuel',
      '2sam': '2samuel',
      '1kgs': '1kings',
      '2kgs': '2kings',
      '1chron': '1chronicles',
      '2chron': '2chronicles',

      mt: 'matthew',
      mk: 'mark',
      lk: 'luke',
      jn: 'john',
      acts: 'acts',
      rom: 'romans',
      rev: 'revelation'
  };

  const normalizedInput =
      englishAliases[wanted] || wanted;

  // First: exact match against the actual API book data
  const exactMatch = books.find(book =>
      [book.id, book.name, book.commonName, book.title]
          .filter(Boolean)
          .some(value => normalize(value) === normalizedInput)
  );

  if (exactMatch) {
      return exactMatch;
  }

  // Second: English → Kiswahili alias lookup
  const swahiliName = swahiliAliases[normalizedInput];

  if (swahiliName) {
      const swahiliMatch = books.find(book =>
          [book.id, book.name, book.commonName, book.title]
              .filter(Boolean)
              .some(value => normalize(value) === swahiliName)
      );

      if (swahiliMatch) {
          return swahiliMatch;
      }
  }

  // Third: allow the user to type the Kiswahili name directly
  const directSwahiliMatch = books.find(book => {
      const values = [book.id, book.name, book.commonName, book.title]
          .filter(Boolean)
          .map(value => normalize(value));

      return values.includes(wanted);
  });

  return directSwahiliMatch;
}

async function fetchBibleVerse(reference, language) {
    const parsed = parseReference(reference);

    if (!parsed) {
        return {
            success: false,
            error: 'Invalid reference. Example: `!verse John 3:16`'
        };
    }

    const translations = await getTranslations();
    const translation = findTranslation(translations, language);

    if (!translation) {
        return {
            success: false,
            error: `No ${language} Bible translation was found.`
        };
    }

    const books = await getBooks(translation.id);
    const book = findBook(books, parsed.book);

    if (!book) {
        return {
            success: false,
            error: `I could not find the book "${parsed.book}".`
        };
    }

    const url =
        `${API_BASE}/${translation.id}/${book.id}/${parsed.chapter}.simple.json`;

    const response = await fetch(url);

    if (!response.ok) {
        return {
            success: false,
            error: 'I could not find that Bible reference.'
        };
    }

    const data = await response.json();

    const verses = (data.chapter?.content || []).filter(
        item => item.type === 'verse'
    );

    const selected = verses.filter(verse =>
        Number(verse.number) >= parsed.startVerse &&
        Number(verse.number) <= parsed.endVerse
    );

    if (!selected.length) {
        return {
            success: false,
            error: 'I could not find that verse.'
        };
    }

    const text = selected
        .map(verse =>
            parsed.startVerse === parsed.endVerse
                ? verse.text
                : `${verse.number}. ${verse.text}`
        )
        .join('\n\n');

    return {
        success: true,
        text,
        book: book.commonName || book.name,
        chapter: parsed.chapter,
        startVerse: parsed.startVerse,
        endVerse: parsed.endVerse,
        translation: translation.englishName || translation.name
    };
}

module.exports = {
    fetchBibleVerse
};