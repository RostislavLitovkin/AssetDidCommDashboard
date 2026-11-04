# Edit Profile mobile design port

## Intent

Update `app/pages/profile/edit.vue` to visually match `ModifyUserProfilePage.xaml` in `~/realXmarketMobileApp`, while preserving the dashboard's profile creation and editing behavior.

## Goals

- Use the mobile screen's full-width landscape cover and translucent top navigation treatment.
- Add the overlapping circular profile picture with a camera action and immediate selected-image preview.
- Match the mobile field labels, placeholders, rounded inputs, bio editor, and paired Cancel/Save actions.
- Keep the existing wallet address and X25519 controls, validation, loading, upload, signing, and navigation behavior.

## Non-goals

- Do not change profile API payloads or the save workflow.
- Do not redesign other profile pages or global buttons and inputs.
- Do not add profile-background editing; it is commented out in the mobile reference.

## Approaches

1. **Direct single-page structural port (selected):** rework only the edit page template and scoped styles, with minimal local preview state. Closest match and smallest regression surface.
2. **Shared mobile-style form components:** reusable, but unnecessary for one screen and would broaden the change.
3. **CSS-only reskin:** cannot reproduce the cover, avatar overlay, camera action, or navigation structure without markup changes.

## Design constraints

- Reuse the existing landscape and default avatar assets; both are identical to the mobile assets.
- Use the mobile screen's navy `#3B4F74`, white, gray, 48px buttons, 24px button radius, and compact field styling, adapted to the dashboard's light/dark surfaces.
- Keep explicit labels, accessible camera and Cancel controls, keyboard focus, and responsive layouts.
- The dashboard-only wallet and encryption fields remain in the same single-column form below the mobile Nickname and Bio fields.
- Cancel returns to `/profile`; Save retains the existing dynamic create/edit submit states.

## Builder latitude

Exact responsive cover width and desktop content measure may be adjusted to avoid distortion and preserve readability, but the mobile hierarchy and visual treatments remain authoritative.
