# EasyMod

Plugin **Nuvio** con 8 provider italiani per Film, Serie TV e Anime.

> Fork del progetto **EasyStreams** di **Real Bestia** ([realbestia1](https://github.com/realbestia1/)).

## Provider

| Provider | Contenuti |
|---|---|
| Guardoserie | Film, Serie TV |
| StreamingCommunity | Film, Serie TV |
| AltadefinizioneStreaming | Film, Serie TV |
| Cineblog001 | Film, Serie TV |
| AltadefinizioneX | Film, Serie TV |
| AnimeUnity | Anime |
| AnimeWorld | Anime |
| AnimeSaturn | Anime |

Cineblog001, AltadefinizioneX e StreamingCommunity risolvono lo stream con lo stesso backend (Vixsrc): non sono fonti indipendenti. Se il backend non risponde, restituiscono tutti una lista vuota.

## Cosa cambia rispetto all'originale

- **AnimeUnity** usa l'API JSON di animeunity.cx; se non risponde, ripiega sullo scraping HTML.
- **StreamingCommunity**: `h=1` viene aggiunto alla playlist solo quando il sito dichiara il 1080p, altrimenti la playlist risponde 403 e non compare nessuno stream.
- **Formato degli stream** semplificato:

  ```text
  🎬 StreamingCommunity · 720p
     Il Trono di Spade S01E01 · 🗣️ ITA
  ```

## Installazione

1. In Nuvio apri **Impostazioni > Plugin**.
2. Aggiungi questo URL:

   ```text
   https://raw.githubusercontent.com/efulbeats-maker/EasyMod/refs/heads/main/
   ```

3. Abilita i provider che vuoi usare.

Per aggiornare: rimuovi il plugin e aggiungilo di nuovo con lo stesso URL, poi riavvia Nuvio.

## Sviluppo

```bash
npm install
node build.js --nuvio            # genera i bundle in providers/
node build.js --nuvio --minify   # versione minificata
npm test                         # test offline con fetch simulata
```

I bundle in `providers/` sono quelli che Nuvio scarica: dopo ogni modifica a `src/` vanno rigenerati e va alzata la versione dello scraper in `manifest.json`.

## Impostazioni opzionali

Si impostano in `SCRAPER_SETTINGS`.

| Impostazione | Predefinito | Funzione |
|---|---|---|
| `guardoserieResolveBase` | `https://easystreams.realbestia.com/resolve/guardoserie` | Endpoint che risolve Guardoserie (solo URL `http(s)` senza credenziali) |
| `guardoserieResolveTimeout` | `10000` ms | Timeout della risoluzione, da 10 a 30000 |
| `altadefinizioneCookie` (o variabile `ALTADEFINIZIONE_COOKIE`) | vuoto | Cookie per altadefinizionestreaming.tv, se il sito chiede una sessione |
| `animeMappingTmdbTimeout` | `5000` ms | Timeout della risoluzione TMDB degli anime stagionali, da 10 a 30000 |

Un valore non valido ripristina il predefinito.

## Limiti

- I test non toccano i siti reali: non garantiscono che i siti rispondano o che le loro pagine non siano cambiate.
- Guardoserie dipende dal server di risoluzione indicato sopra: se è irraggiungibile, restituisce una lista vuota.
- I siti possono bloccare per area geografica o con protezioni anti-bot: in quel caso il provider restituisce una lista vuota.

## Crediti e licenza

Fork di EasyStreams di [realbestia1](https://github.com/realbestia1/). Licenza **ISC**, come dichiarato nel `package.json` del progetto originale.
