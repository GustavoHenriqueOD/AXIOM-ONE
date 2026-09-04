type CategoryInput = { id: string; name: string };

type LearnedTransaction = { description: string; categoryId: string };

const STOP_TOKENS = new Set([
  "de", "do", "da", "dos", "das", "em", "no", "na", "nos", "nas",
  "com", "por", "para", "via", "ref", "serv",
  "pix", "ted", "doc", "pag",
  "transferencia", "transferência", "recebido", "recebida", "enviado", "enviada",
  "pagamento", "compra", "saque", "deposito", "debito", "credito", "boleto",
]);

export function buildLearnedMatcher(
  transactions: LearnedTransaction[],
  categories: CategoryInput[]
): (description: string) => string | null {
  const catIds = new Set(categories.map((c) => c.id));
  // token → Map<categoryId, frequency>
  const tokenMap = new Map<string, Map<string, number>>();

  for (const tx of transactions) {
    if (!catIds.has(tx.categoryId)) continue;
    const tokens = normalize(tx.description)
      .split(/[\s\-_.,/]+/)
      .filter((t) => t.length >= 4 && !STOP_TOKENS.has(t));

    for (const token of tokens) {
      if (!tokenMap.has(token)) tokenMap.set(token, new Map());
      const catMap = tokenMap.get(token)!;
      catMap.set(tx.categoryId, (catMap.get(tx.categoryId) ?? 0) + 1);
    }
  }

  return (description: string): string | null => {
    const tokens = normalize(description)
      .split(/[\s\-_.,/]+/)
      .filter((t) => t.length >= 4 && !STOP_TOKENS.has(t));

    const scores = new Map<string, number>();
    for (const token of tokens) {
      const catMap = tokenMap.get(token);
      if (!catMap) continue;
      for (const [catId, count] of catMap) {
        scores.set(catId, (scores.get(catId) ?? 0) + count);
      }
    }

    if (!scores.size) return null;

    let best: string | null = null;
    let bestScore = 0;
    for (const [catId, score] of scores) {
      if (score > bestScore) { bestScore = score; best = catId; }
    }
    return best;
  };
}

const KEYWORD_GROUPS: Record<string, string[]> = {
  "alimentação/mercado": [
    "supermercado", "mercado", "atacadao", "extra", "carrefour", "walmart", "pao de acucar", "assai",
  ],
  "restaurante/alimentação": [
    "restaurante", "lanchonete", "ifood", "rappi", "uber eats", "mcdonald", "burger", "pizza",
    "sushi", "churrasco", "padaria", "cafe", "coffee",
  ],
  "transporte": [
    "uber", "cabify", "99pop", "taxi", "metro", "onibus", "combustivel", "gasolina",
    "posto shell", "posto br", "petrobras", "estacionamento",
  ],
  "saúde": [
    "farmacia", "drogaria", "droga", "hospital", "clinica", "medico", "dentista",
    "plano de saude", "unimed",
  ],
  "educação": [
    "escola", "faculdade", "universidade", "curso", "mensalidade", "colegio", "usp", "unifesp",
  ],
  "lazer/entretenimento": [
    "netflix", "spotify", "amazon prime", "disney", "youtube", "steam", "cinema", "teatro",
  ],
  "academia": [
    "academia", "smartfit", "bodytech", "crossfit",
  ],
  "moradia": [
    "aluguel", "condominio", "iptu", "luz", "energia", "agua", "gas", "internet",
    "tim", "claro", "vivo", "oi",
  ],
  "compras": [
    "amazon", "mercado livre", "shopee", "magazine", "lojas americanas", "renner", "shein",
  ],
  "viagem": [
    "hotel", "airbnb", "latam", "gol", "azul", "booking", "passagem",
  ],
  "pet": [
    "veterinario", "pet shop", "banho e tosa",
  ],
};

function normalize(str: string): string {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function matchCategory(description: string, categories: CategoryInput[]): string | null {
  const normalizedDesc = normalize(description);

  for (const category of categories) {
    const normalizedCatName = normalize(category.name);

    // Direct substring match of category name in description
    if (normalizedDesc.includes(normalizedCatName)) {
      return category.id;
    }

    // Keyword group match
    for (const [groupKey, keywords] of Object.entries(KEYWORD_GROUPS)) {
      const groupNormalized = normalize(groupKey);
      // Check if this category roughly matches the group label
      const catMatchesGroup =
        normalizedCatName.includes(groupNormalized.split("/")[0]) ||
        groupNormalized.split("/").some((part) => normalizedCatName.includes(part));

      if (catMatchesGroup) {
        for (const keyword of keywords) {
          if (normalizedDesc.includes(keyword)) {
            return category.id;
          }
        }
      }
    }
  }

  // Second pass: try keyword match regardless of category name alignment
  // Match against category name directly via all keyword groups
  for (const category of categories) {
    const normalizedCatName = normalize(category.name);
    for (const [, keywords] of Object.entries(KEYWORD_GROUPS)) {
      for (const keyword of keywords) {
        if (normalizedDesc.includes(keyword)) {
          // Check if this keyword's group is somewhat related to the category
          // We just return the first category that matches any keyword group
          // to avoid false positives, skip this secondary pass
          void normalizedCatName;
        }
      }
    }
  }

  // Final pass: keyword match against normalized description, return best matching category
  for (const [, keywords] of Object.entries(KEYWORD_GROUPS)) {
    for (const keyword of keywords) {
      if (normalizedDesc.includes(keyword)) {
        // Find any category that has a name matching the group
        for (const category of categories) {
          const normalizedCatName = normalize(category.name);
          for (const [groupKey] of Object.entries(KEYWORD_GROUPS)) {
            const parts = normalize(groupKey).split("/");
            if (parts.some((p) => normalizedCatName.includes(p))) {
              const groupKeywords = KEYWORD_GROUPS[groupKey];
              if (groupKeywords.includes(keyword)) {
                return category.id;
              }
            }
          }
        }
      }
    }
  }

  return null;
}
