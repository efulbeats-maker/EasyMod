# EasyMod

Plugin Nuvio con 6 provider italiani per Film, Serie TV e Anime.

## Provider supportati

- **Guardoserie** (Film e Serie TV)
- **AnimeUnity** (Anime)
- **AnimeWorld** (Anime)
- **AnimeSaturn** (Anime)
- **StreamingCommunity** (Film e Serie TV)
- **AltadefinizioneStreaming** (Film e Serie TV)

L'elenco corrisponde ai 6 scraper dichiarati in `manifest.json`.

## Installazione su Nuvio

1. Apri **Nuvio**.
2. Vai in **Impostazioni > Plugin**.
3. Incolla l'URL base del plugin (deve puntare al `manifest.json` pubblicato insieme a `providers/`).
4. URL di installazione EasyMod:
   ```text
   https://raw.githubusercontent.com/efulbeats-maker/EasyMod/refs/heads/main/
   ```
5. Se l'URL è raggiungibile e i bundle sono validi, Nuvio mostrerà i provider.

## Aggiornamento del plugin

1. Vai in **Impostazioni > Plugin**.
2. Rimuovi EasyMod e aggiungilo di nuovo con lo stesso URL, oppure usa la funzione di aggiornamento dei plugin se disponibile.
3. Riavvia Nuvio per caricare la nuova versione del `manifest.json`.

## Build `--nuvio`

```bash
npm install
node build.js --nuvio
```

Variante minificata (stesse 6 voci del manifest):

```bash
node build.js --nuvio --minify
```

La build genera solo i bundle dei 6 scraper del manifest.

## Test

```bash
npm install
npm test
```

Equivalente esplicito:

```bash
node --test tests/nuvio-plugin.test.js tests/nuvio-bundles.test.js tests/anime-seasonal-imdb.test.js tests/anime-frieren-bundle.test.js
```

I test sono offline con fetch simulata (nessuna richiesta live streaming).

Nota anime S2+: le lookup TMDB `tv/series/anime` con `season >= 2` vengono
risolte via `GET /3/tv/{id}/external_ids` verso IMDb e proseguono solo sul
mapping IMDb con stessa stagione (`matchedBy: null` resta accettato quando
`kitsu.episode` è valido); in caso di metadata non valido o mappatura
incompleta/incoerente il provider restituisce fail-safe `[]` senza fallback
al mapping TMDB. L'assenza di estrazione di episodi non pertinenti vale per i
casi coperti dai test con dati simulati e non garantisce il riconoscimento
semantico di ogni stagione se il servizio remoto fornisce dati falsi.

## Impostazioni

- `SCRAPER_SETTINGS.guardoserieResolveBase`: endpoint completo incluso il percorso, valore predefinito `https://easystreams.realbestia.com/resolve/guardoserie`. Solo URL `http(s)` senza credenziali, query, hash o spazi; i valori non validi usano il valore predefinito. Gli spazi iniziali e finali vengono rimossi, le barre finali vengono tolte e i parametri vengono codificati con `encodeURIComponent`.
- `SCRAPER_SETTINGS.guardoserieResolveTimeout`: timeout in millisecondi, predefinito `10000`, consentito da `10` a `30000`; i valori non validi usano il valore predefinito. Se la risposta supera il tempo massimo, la ricerca restituisce una lista vuota.
- `SCRAPER_SETTINGS.altadefinizioneCookie` oppure variabile d'ambiente `ALTADEFINIZIONE_COOKIE`: cookie facoltativo per `https://altadefinizionestreaming.tv`. Il plugin non usa più un cookie predefinito incorporato nei bundle Nuvio. Se vuoto, le richieste non inviano alcun header `Cookie`; se il sito richiede una sessione valida, il provider restituisce una lista vuota.
- `SCRAPER_SETTINGS.animeMappingTmdbTimeout`: timeout in millisecondi per la risoluzione TMDB `external_ids` degli anime stagionali, predefinito `5000`, consentito da `10` a `30000`; i valori non validi usano il valore predefinito.

## Limiti

- I successi dei test con dati simulati non garantiscono che i siti reali rispondano o che la struttura delle pagine sia invariata.
- Dipendenza dal server Guardoserie: il client Nuvio chiama l'endpoint resolve invece di leggere direttamente il sito. Se l'endpoint non è raggiungibile, il provider restituisce una lista vuota.
- I siti di origine possono applicare blocchi geografici o protezioni anti-bot; in tal caso i provider restituiscono una lista vuota.

---

Derivato da realbestia1/easystreams; progetto originale dichiara ISC in package.json.

**Powered by [realbestia1](https://github.com/realbestia1/)**
