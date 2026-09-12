# YouTube IFrame Player API

`youtube-widget-api.js` is an unmodified local snapshot of YouTube's official widget API, retrieved on 2026-09-06:

https://www.youtube.com/s/player/f572e43c/www-widgetapi.vflset/www-widgetapi.js

It is bundled so extension pages never execute remotely hosted JavaScript. The actual YouTube player remains a normal cross-origin `https://www.youtube.com/embed/…` iframe. Do not inline or replace the video player, remove its controls, or suppress its ads.

API reference: https://developers.google.com/youtube/iframe_api_reference
API terms: https://developers.google.com/youtube/terms/api-services-terms-of-service

Upstream ownership and terms apply to this file; the Tabler icon license does not apply. When updating the snapshot, inspect the upstream source, verify it does not load additional scripts into the extension origin, and rerun the player preview and extension tests.
