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

    return books.find(book =>
        [book.id, book.name, book.commonName, book.title]
            .filter(Boolean)
            .some(value => normalize(value) === wanted)
    );
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