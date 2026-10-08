# BIMI Result Viewer for Thunderbird

This Thunderbird add-on displays BIMI-related authentication information for the currently displayed message in a message display action popup.

This version intentionally does not use Experiment APIs and does not modify Thunderbird's built-in message list or message header UI.

## Features

* Reads the currently displayed message using standard Thunderbird MailExtension APIs.
* Parses raw message headers.
* Checks:

  * `Authentication-Results: bimi=pass`
  * `policy.authority=pass`
  * presence of `BIMI-Indicator`
  * match between BIMI `header.d` and the Header-From domain
* Shows SPF, DKIM, DMARC, and BIMI results in the popup.
* Shows the BIMI logo in the popup when an HTTPS URL in `policy.indicator-uri` or `BIMI-Indicator` is available. The popup validates the URL again and restricts image loading to HTTPS.

## Internationalization

This add-on supports localization using the standard WebExtension `_locales` mechanism.

Currently supported languages:

* English (`en`)
* Japanese (`ja`)

The default locale is English.

## Limitations

* This add-on does not modify Thunderbird's built-in message list UI.
* This add-on does not replace the sender avatar in the message header.
* This add-on does not perform cryptographic VMC validation.
* This add-on relies on authentication results already added by the receiving mail server.
* This add-on does not perform BIMI DNS lookups or independent VMC certificate validation.
