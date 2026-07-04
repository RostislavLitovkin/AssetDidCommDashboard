# Injecting an X25519 Key from C# (.NET MAUI HybridWebView)

This guide explains how a native .NET MAUI app can host the Asset DIDComm
dashboard inside a `HybridWebView` and inject the user's X25519 secret key
(JWK) from C# into the dashboard's JavaScript, so the web app can decrypt
DIDComm payloads without the user ever pasting a key manually.

It covers:

1. [How the dashboard's injection API works](#1-the-javascript-injection-api)
2. [Setting up HybridWebView in .NET MAUI](#2-setting-up-hybridwebview-in-net-maui)
3. [The C# ↔ JavaScript handshake](#3-the-handshake-waiting-until-the-dashboard-is-ready)
4. [Injecting the key from C#](#4-injecting-the-key-from-c)
5. [Building the X25519 JWK in C#](#5-building-the-x25519-jwk-in-c)
6. [Using a plain `WebView` for the hosted dashboard](#6-alternative-plain-webview-pointed-at-the-deployed-dashboard)
7. [Security considerations](#7-security-considerations)
8. [Troubleshooting](#8-troubleshooting)

---

## 1. The JavaScript injection API

The dashboard installs a global bridge object on `window` as soon as the Nuxt
client boots (see `app/plugins/keyInjection.client.ts` and
`app/services/injection/x25519InjectionBridge.ts`):

```js
window.assetDidComm = {
  version: 1,

  // Accepts a JWK as a JSON string *or* a plain object.
  // Returns { ok: true, keyId?: string } or { ok: false, error: string }.
  injectX25519Key(key, options /* { persist?: boolean } */) {},

  // Removes the key from the app state and localStorage.
  clearX25519Key() {},

  // True when a secret key is currently loaded.
  hasX25519Key() {}
}
```

The key must be an X25519 secret **JWK**:

```json
{
  "kty": "OKP",
  "crv": "X25519",
  "d": "<base64url-encoded 32-byte secret scalar>",
  "x": "<base64url-encoded 32-byte public key>",
  "kid": "optional-key-id"
}
```

`kty`, `crv`, and a non-empty `d` are mandatory (validated by
`app/stores/settings.ts` → `normalizeX25519SecretJwk`). Always include `x` as
well — parts of the dashboard use it to display/verify the public half. A
wrapped export of the form `{"publicJwk": {...}, "privateJwk": {...}}` (what
the dashboard's own **Export** button produces) is also accepted.

Behaviour on success:

- The key is stored in the Pinia settings store, which is what every
  encrypt/decrypt path in the dashboard reads (`settings.x25519SecretJwk`).
- By default it is also persisted to `localStorage` under
  `asset-didcomm.x25519-secret-jwk`, so it survives page reloads. Pass
  `{ persist: false }` if the native app is the source of truth and the key
  should live only in memory for the current page (recommended when the key
  sits in platform secure storage — see [Security](#7-security-considerations)).
- A DOM event `assetdidcomm:x25519-key-injected` is dispatched on `window`
  (with `detail.keyId`), so Vue components can react immediately.
- If the page runs inside a HybridWebView, the bridge reports the outcome back
  to C# as a raw message (see next section).

### Messages the dashboard sends to the host

When hosted in a HybridWebView, the bridge calls
`window.HybridWebView.SendRawMessage(...)` with JSON strings:

| Message | When | Shape |
|---|---|---|
| Bridge ready | Nuxt client has booted, injection is available | `{"type":"assetDidComm:bridgeReady","hasKey":false}` |
| Key injected | After every `injectX25519Key` call | `{"type":"assetDidComm:keyInjected","ok":true,"keyId":"..."}` or `{"type":"assetDidComm:keyInjected","ok":false,"error":"..."}` |

These arrive in C# through the `HybridWebView.RawMessageReceived` event and are
the recommended way to know **when** it is safe to inject.

### Early injection (before the app boots)

If the host evaluates JavaScript before Nuxt has installed the bridge (e.g. in
a script that runs at document start), it can stash the key instead:

```js
window.__assetDidCommPendingX25519Key = '<jwk json string>';
```

The bridge drains this slot the moment it installs, injects the key, deletes
the global, and still emits the `assetDidComm:keyInjected` raw message. This
makes injection timing-proof: write the pending slot early, and it works
whether or not the app has booted yet.

---

## 2. Setting up HybridWebView in .NET MAUI

`HybridWebView` shipped in **.NET MAUI 9** (`net9.0-*` targets). Unlike the
classic `WebView`, it serves **local static web content** bundled inside the
app package from a virtual origin (`https://0.0.0.1/`), and provides a
first-class C# ↔ JavaScript messaging channel.

### 2.1 Build the dashboard as static files

The dashboard is a Nuxt app with `ssr: false`, so it generates to plain static
files:

```bash
# In this repository
NUXT_APP_BASE_URL=/ npm install
NUXT_APP_BASE_URL=/ npm run generate
# Output: .output/public/
```

> **Important:** the GitHub Pages workflow builds with a non-root
> `NUXT_APP_BASE_URL`. For HybridWebView the app is served from the origin
> root, so generate with `NUXT_APP_BASE_URL=/` (the default when the variable
> is unset).

### 2.2 Put the output into the MAUI project

Copy everything from `.output/public/` into your MAUI project at:

```
YourMauiApp/
└── Resources/
    └── Raw/
        └── wwwroot/
            ├── index.html
            ├── _nuxt/…
            └── …
```

Files under `Resources/Raw` get the `MauiAsset` build action automatically via
the wildcard in the default `.csproj`:

```xml
<ItemGroup>
  <MauiAsset Include="Resources\Raw\**"
             LogicalName="%(RecursiveDir)%(Filename)%(Extension)" />
</ItemGroup>
```

`HybridWebView` defaults to `HybridRoot="wwwroot"` and
`DefaultFile="index.html"`, which matches the layout above.

### 2.3 Add the control

```xml
<!-- MainPage.xaml -->
<ContentPage xmlns="http://schemas.microsoft.com/dotnet/2021/maui"
             xmlns:x="http://schemas.microsoft.com/winfx/2009/xaml"
             x:Class="AssetDidCommHost.MainPage">
    <Grid>
        <HybridWebView x:Name="DashboardWebView"
                       RawMessageReceived="OnRawMessageReceived" />
    </Grid>
</ContentPage>
```

### 2.4 The `HybridWebView.js` client script

The C# ↔ JS channel (`window.HybridWebView.SendRawMessage`, the
`HybridWebViewMessageReceived` DOM event, and the plumbing behind
`InvokeJavaScriptAsync`) is provided by a standard `HybridWebView.js` script
that the web content must load. Take the file from the official docs
(<https://learn.microsoft.com/dotnet/maui/user-interface/controls/hybridwebview>)
and reference it from the page. For the generated Nuxt output the simplest way
is to add it once in `nuxt.config.ts` before generating:

```ts
app: {
  head: {
    script: [{ src: "/HybridWebView.js" }]
  }
}
```

…and drop `HybridWebView.js` into this repo's `public/` directory so it is
copied into `.output/public/`. (Newer MAUI versions inject the script
automatically; keeping the explicit reference is harmless either way.)

The dashboard's bridge degrades gracefully: every call to
`window.HybridWebView.SendRawMessage` is guarded, so the same build keeps
working in an ordinary browser.

---

## 3. The handshake: waiting until the dashboard is ready

You must not inject before `window.assetDidComm` exists. There are three
correct strategies — the first is recommended.

### Strategy A (recommended): wait for the `bridgeReady` raw message

The dashboard tells you when it is ready. Buffer the key until then:

```csharp
// MainPage.xaml.cs
using System.Text.Json;

public partial class MainPage : ContentPage
{
    private readonly TaskCompletionSource _bridgeReady =
        new(TaskCreationOptions.RunContinuationsAsynchronously);

    public MainPage()
    {
        InitializeComponent();
    }

    private void OnRawMessageReceived(object? sender, HybridWebViewRawMessageReceivedEventArgs e)
    {
        if (string.IsNullOrEmpty(e.Message))
            return;

        using var doc = JsonDocument.Parse(e.Message);
        var type = doc.RootElement.TryGetProperty("type", out var t) ? t.GetString() : null;

        switch (type)
        {
            case "assetDidComm:bridgeReady":
                _bridgeReady.TrySetResult();
                break;

            case "assetDidComm:keyInjected":
                var ok = doc.RootElement.GetProperty("ok").GetBoolean();
                if (!ok)
                {
                    var error = doc.RootElement.TryGetProperty("error", out var err)
                        ? err.GetString()
                        : "unknown error";
                    // Surface this: the key was rejected (malformed JWK, wrong curve, …)
                    System.Diagnostics.Debug.WriteLine($"Key injection failed: {error}");
                }
                break;
        }
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();

        await _bridgeReady.Task;                      // dashboard booted
        await InjectKeyAsync();                       // now it is safe
    }
}
```

### Strategy B: the pending-key slot

If you prefer fire-and-forget, write the pending global as early as you can
(it is safe to do so even *after* boot — the bridge also accepts direct calls):

```csharp
// jwkJson is the serialized JWK string — see section 5
var jsLiteral = JsonSerializer.Serialize(jwkJson);   // escape as a JS string literal
await DashboardWebView.EvaluateJavaScriptAsync(
    $"window.assetDidComm ? window.assetDidComm.injectX25519Key({jsLiteral}) " +
    $": (window.__assetDidCommPendingX25519Key = {jsLiteral})");
```

This one-liner covers both timings: inject immediately if the bridge exists,
otherwise park the key for the bridge to drain on boot.

### Strategy C: polling (last resort)

```csharp
private async Task WaitForBridgeAsync(CancellationToken ct)
{
    while (!ct.IsCancellationRequested)
    {
        var result = await DashboardWebView.EvaluateJavaScriptAsync(
            "typeof window.assetDidComm !== 'undefined' ? 'ready' : 'not-ready'");
        if (result?.Trim('"') == "ready")
            return;
        await Task.Delay(100, ct);
    }
}
```

Only use this if you cannot receive raw messages (e.g. a plain `WebView`, see
section 6).

---

## 4. Injecting the key from C#

### 4.1 With `InvokeJavaScriptAsync` (typed, recommended)

`HybridWebView.InvokeJavaScriptAsync` calls a globally reachable JS function
with serialized arguments and deserializes the return value. Because MAUI apps
are trimmed/AOT-compiled, it requires **source-generated** JSON metadata:

```csharp
using System.Text.Json.Serialization;

public sealed record InjectionResult
{
    [JsonPropertyName("ok")]     public bool    Ok    { get; init; }
    [JsonPropertyName("keyId")]  public string? KeyId { get; init; }
    [JsonPropertyName("error")]  public string? Error { get; init; }
}

public sealed record InjectionOptions
{
    [JsonPropertyName("persist")] public bool Persist { get; init; }
}

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(InjectionResult))]
[JsonSerializable(typeof(InjectionOptions))]
[JsonSerializable(typeof(string))]
internal partial class BridgeJsonContext : JsonSerializerContext;
```

```csharp
private async Task InjectKeyAsync()
{
    var jwkJson = await LoadKeyFromSecureStorageAsync();  // see section 5/7

    var result = await DashboardWebView.InvokeJavaScriptAsync(
        "window.assetDidComm.injectX25519Key",
        BridgeJsonContext.Default.InjectionResult,
        new object?[] { jwkJson, new InjectionOptions { Persist = false } },
        new JsonTypeInfo?[]
        {
            BridgeJsonContext.Default.String,
            BridgeJsonContext.Default.InjectionOptions
        });

    if (result is not { Ok: true })
        throw new InvalidOperationException($"X25519 injection rejected: {result?.Error}");
}
```

Notes:

- The **first argument is passed as a JSON string** and the bridge parses it —
  you never have to hand-build JavaScript source containing the key.
- `Persist = false` keeps the key out of the WebView's `localStorage`; the
  native app re-injects on every launch. Omit the options argument (or pass
  `Persist = true`) if you *want* the dashboard to remember the key between
  sessions.

### 4.2 With `EvaluateJavaScriptAsync` (string-based fallback)

If you cannot use `InvokeJavaScriptAsync` (older MAUI patch, plain `WebView`),
evaluate the call directly. **The single most common bug here is broken
escaping** — never concatenate raw JSON into a script. Serialize the JSON
string *again* so it becomes a valid JS string literal:

```csharp
var jwkJson = await LoadKeyFromSecureStorageAsync();

// jwkJson is JSON; JsonSerializer.Serialize(jwkJson) turns it into a quoted,
// fully escaped JavaScript string literal: "{\"kty\":\"OKP\",...}"
var jsLiteral = JsonSerializer.Serialize(jwkJson);

var resultJson = await DashboardWebView.EvaluateJavaScriptAsync(
    $"JSON.stringify(window.assetDidComm.injectX25519Key({jsLiteral}, {{ persist: false }}))");
```

`EvaluateJavaScriptAsync` returns a string; the `JSON.stringify(...)` wrapper
guarantees you get a parseable `{"ok":...}` payload back on every platform
(some platforms additionally quote/escape the returned string — unescape
before parsing if needed).

### 4.3 Clearing the key (e.g. on logout)

```csharp
await DashboardWebView.EvaluateJavaScriptAsync("window.assetDidComm.clearX25519Key()");
```

This clears both the in-memory store and the `localStorage` copy.

---

## 5. Building the X25519 JWK in C#

The JWK fields `d` and `x` are the raw 32-byte X25519 secret scalar and public
key, **base64url-encoded without padding** (RFC 7515 §2 / RFC 8037).

```csharp
using System.Text.Json;
using System.Text.Json.Serialization;

public static class X25519Jwk
{
    public static string Create(byte[] secretKey, byte[] publicKey, string? keyId = null)
    {
        if (secretKey.Length != 32) throw new ArgumentException("X25519 secret key must be 32 bytes.");
        if (publicKey.Length != 32) throw new ArgumentException("X25519 public key must be 32 bytes.");

        var jwk = new Dictionary<string, string>
        {
            ["kty"] = "OKP",
            ["crv"] = "X25519",
            ["d"] = Base64Url(secretKey),
            ["x"] = Base64Url(publicKey)
        };
        if (!string.IsNullOrEmpty(keyId))
            jwk["kid"] = keyId;

        return JsonSerializer.Serialize(jwk, JwkJsonContext.Default.DictionaryStringString);
    }

    private static string Base64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        // On .NET 9+ you can use System.Buffers.Text.Base64Url.EncodeToString(bytes) instead.
}

[JsonSerializable(typeof(Dictionary<string, string>))]
internal partial class JwkJsonContext : JsonSerializerContext;
```

If you only have the 32-byte secret and need to derive the public key, use any
X25519 implementation, e.g. BouncyCastle:

```csharp
using Org.BouncyCastle.Crypto.Parameters;

var priv = new X25519PrivateKeyParameters(secretKey, 0);
var publicKey = priv.GeneratePublicKey().GetEncoded(); // 32 bytes
```

(NSec's `NSec.Cryptography.KeyAgreementAlgorithm.X25519` works equally well.)

> **Watch out:** an X25519 (encryption / ECDH) key is *not* an Ed25519
> (signing) key. Do not put a wallet's Ed25519/sr25519 signing key into this
> JWK — the dashboard expects the DIDComm key-agreement key that is published
> as `publicEncryptionKey.x25519` in the DID document.

---

## 6. Alternative: plain `WebView` pointed at the deployed dashboard

`HybridWebView` serves bundled local content. If you instead want to host the
deployed dashboard (e.g. `https://realxmessage.xcavate.io/`), use the classic
`WebView`:

```xml
<WebView x:Name="DashboardWebView"
         Source="https://realxmessage.xcavate.io/"
         Navigated="OnNavigated" />
```

```csharp
private async void OnNavigated(object? sender, WebNavigatedEventArgs e)
{
    if (e.Result != WebNavigationResult.Success)
        return;

    var jwkJson = await LoadKeyFromSecureStorageAsync();
    var jsLiteral = JsonSerializer.Serialize(jwkJson);

    // Covers both "bridge already installed" and "app still booting".
    await DashboardWebView.EvaluateJavaScriptAsync(
        $"window.assetDidComm ? window.assetDidComm.injectX25519Key({jsLiteral}) " +
        $": (window.__assetDidCommPendingX25519Key = {jsLiteral})");
}
```

Differences from HybridWebView:

- There is no `window.HybridWebView.SendRawMessage`, so you will not receive
  `bridgeReady` / `keyInjected` callbacks. The bridge detects this and simply
  skips host notification. Use the `Navigated` event + the pending-key slot
  (as above), or poll (Strategy C).
- `Navigated` fires when the document loads, which on an SPA is usually
  *before* Nuxt finishes booting — this is exactly why the pending-key slot
  exists. Do not replace it with a bare `injectX25519Key` call.

---

## 7. Security considerations

- **Store the key natively, inject transiently.** Keep the JWK in
  [`SecureStorage`](https://learn.microsoft.com/dotnet/maui/platform-integration/storage/secure-storage)
  (Keychain on iOS, encrypted preferences on Android) and inject with
  `{ persist: false }`. The WebView's `localStorage` is not hardware-backed;
  with `persist: false` the bridge also actively removes any previously
  persisted copy.

  ```csharp
  await SecureStorage.Default.SetAsync("x25519-jwk", jwkJson);
  var jwkJson = await SecureStorage.Default.GetAsync("x25519-jwk");
  ```

- **Never log the JWK.** Neither in C# (`Debug.WriteLine`) nor by leaving
  `console.log` calls in injected scripts. The `keyInjected` raw message
  intentionally carries only `ok`/`keyId`/`error`, never key material.
- **Disable WebView debugging in release builds.** On Android,
  `WebView.SetWebContentsDebuggingEnabled(true)` (or MAUI's equivalents) lets
  anyone with adb read the page's memory, including the injected key.
- **Only inject into content you control.** With HybridWebView the content is
  bundled, so this is given. With a remote `WebView`, verify
  `e.Url`/`Source` starts with your dashboard origin before evaluating any
  script that contains the key, and never inject after navigation to a
  third-party page.
- **Clear on logout.** Call `window.assetDidComm.clearX25519Key()` and remove
  the entry from `SecureStorage` when the user signs out.

---

## 8. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `window.assetDidComm is undefined` | You injected before Nuxt booted. Use the `bridgeReady` raw message (Strategy A) or the pending-key slot (Strategy B). |
| `{"ok":false,"error":"X25519 secret key must be a JSON JWK…"}` | The JWK failed validation: `kty` must be `"OKP"`, `crv` must be `"X25519"`, `d` must be a non-empty string. Check base64url encoding (no `+`, `/`, or `=`). |
| `{"ok":false,"error":"Unexpected token …"}` | You passed a string that is not valid JSON — almost always an escaping bug. Use `JsonSerializer.Serialize(jwkJson)` to build the JS literal (section 4.2), or pass the string through `InvokeJavaScriptAsync` (section 4.1). |
| No `RawMessageReceived` events at all | `HybridWebView.js` is not loaded by the page (section 2.4), or you are using a plain `WebView` (section 6). |
| Dashboard loads a blank page in HybridWebView | The static build was generated with a non-root `NUXT_APP_BASE_URL`, so all `_nuxt/` asset URLs 404 against `https://0.0.0.1/`. Regenerate with `NUXT_APP_BASE_URL=/`. |
| Key injects but decryption still fails | Wrong key: make sure `d`/`x` are the X25519 **key-agreement** pair from the DID document (`publicEncryptionKey.x25519`), not an Ed25519 signing key. Compare the JWK `x` with the value shown on the bucket info page. |
| Key disappears after app restart | Expected with `persist: false` — re-inject on every launch (that is the point). Pass no options (or `persist: true`) if you want `localStorage` persistence instead. |

---

## Appendix: end-to-end minimal host page flow

1. `npm run generate` (with root base URL) → copy `.output/public/` to
   `Resources/Raw/wwwroot/`.
2. App starts → `HybridWebView` serves `index.html` from
   `https://0.0.0.1/`.
3. Nuxt boots → `keyInjection.client.ts` installs `window.assetDidComm`,
   drains `window.__assetDidCommPendingX25519Key` if the host already set it,
   and sends `{"type":"assetDidComm:bridgeReady", ...}` to C#.
4. C# receives `bridgeReady` → reads the JWK from `SecureStorage` → calls
   `window.assetDidComm.injectX25519Key(jwkJson, { persist: false })` via
   `InvokeJavaScriptAsync`.
5. Bridge validates the JWK, stores it in the settings store, dispatches
   `assetdidcomm:x25519-key-injected` for the UI, and reports
   `{"type":"assetDidComm:keyInjected","ok":true,...}` back to C#.
6. The dashboard decrypts DIDComm payloads using `settings.x25519SecretJwk` —
   no manual key entry required.
