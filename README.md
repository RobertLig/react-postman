# Wayline frontend

Wayline is a React interface for the Quarkus API in `../quarkus-demo/myapp`.
It connects people who need a parcel delivered with travelers already heading
that way and willing to carry it. Members can post an ad looking for a courier
or offer to deliver a parcel; Wayline is for parcel delivery, not ride-sharing.
The frontend also supports email and Google sign-in, email verification and
password reset, browsing/searching delivery ads, route and profile photo
uploads, route management, direct messages with attachments/reactions/live
updates, member block controls, and a role-gated support inbox for
administrators. Profile phone numbers use a country-aware input and are saved
in international format; the initial country comes from the browser locale.

## Run locally

```sh
npm install
npm start
```

The frontend expects the API at `http://localhost:8080` by default. Override
this for a different API origin with a local `.env` file:

```env
REACT_APP_API_URL=http://localhost:8080
REACT_APP_GOOGLE_CLIENT_ID=your-google-web-client-id
REACT_APP_GEOCODING_URL=https://photon.komoot.io/api/
```

## Languages

The interface supports English and Polish. It checks the browser's preferred
language list in order; `pl` and regional variants select Polish, and English
is the fallback. Frontend interface text is kept in `src/i18n.js` and ships
with the frontend, so it works from a static CDN without a translation service.
Backend validation and exception messages remain in the API's
`resources/i18n` translations, where they are selected from the request's
`Accept-Language` header. Keep UI copy in the frontend and API-generated
messages in the backend.

The Google client ID defaults to the one configured by the development API.
The API must allow the frontend origin through its CORS configuration. For
local development, start Quarkus with `./mvnw quarkus:dev` from the API
project; its dev profile allows `http://localhost:3000`.

The route-posting form uses Photon place search with OpenStreetMap data for
starting cities, destinations, and stops. Select a suggestion to fill in the
coordinates required by the API; manually typed place names are not submitted
without a matching selection. Place names are requested in the browser's
preferred language (using the first entry in its language preferences, with
the browser's primary language as a fallback); Photon returns a local name
when no translation is available. The default Photon endpoint is free to use
without a key, but it is a shared community service without an availability
guarantee. For higher traffic, host Photon yourself and set
`REACT_APP_GEOCODING_URL` to that instance's API URL. Place results are
attributed to OpenStreetMap contributors in the interface.

The posting form also includes an interactive Leaflet map using OpenStreetMap
tiles. Focus or select a starting city, destination, or stop to make it the
active map field; clicking the map reverse-geocodes that point into that field.
Map clicks use the same Photon endpoint and language preference as typeahead.
The map uses the community OSM tile service, which is free under its usage
policy but has no service guarantee; for higher traffic, choose a tile provider
or host tiles that supports your usage. OpenStreetMap map data and tiles are
attributed in the map.

Uploads use the API's short-lived signed S3 URLs. Route photos and avatars are
JPG/PNG images up to 5 MB; each route allows three photos. Message attachments
are limited to 5 MB and the MIME types allowed by the API, with up to ten
attachments per message. The S3 bucket must allow browser `PUT` requests from
the frontend origin.

The access token is kept in tab-scoped session storage. Expired API requests
attempt the API refresh-cookie flow once, then return the user to sign-in if
the refresh cookie is unavailable or invalid. Role-gated controls are only a
convenience; the Quarkus API remains responsible for authorization.

In dev/test, the API links verification and password-reset emails to
`http://localhost:3000`. For production, set `FRONTEND_BASE_URL` in the API
environment to the public frontend origin (for example,
`https://app.example.com`).

## Deploy to Cloudflare Pages

Create a Pages project connected to this repository and use:

- **Build command:** `npm run build`
- **Build output directory:** `build`
- **Root directory:** `/` (the repository root)

Set these build environment variables in the Pages project:

- `REACT_APP_API_URL`: the public Quarkus API URL, such as
  `https://myapp-quarkus.onrender.com`
- `REACT_APP_GOOGLE_CLIENT_ID`: optional; defaults to the Google client ID
  already used by the app

The `public/_redirects` file makes direct visits and refreshes on client-side
routes serve the React app. After the first successful deployment, Cloudflare
Pages shows the site's public URL, typically
`https://<project-name>.pages.dev`.

In the Render API service, set `FRONTEND_BASE_URL` to that frontend origin
(for example, `https://wayline.pages.dev`) so verification and password-reset
links open the website. Include that origin in `CORS_ORIGINS` so browsers can
call the API; retain `http://localhost:3000` there too if you still call the
deployed API from your local frontend. Add the frontend origin to the Google
OAuth client's authorized JavaScript origins as well. If the Pages URL
changes, update these origin settings and redeploy the frontend if its API URL
changes.

## Scripts

- `npm start` starts the development server.
- `npm test -- --watchAll=false` runs the frontend tests once.
- `npm run build` creates the production build in the ignored `build/` folder.

## Styling

The interface uses the requested OKLCH design tokens and regular CSS; Tailwind
CSS is not installed or required. `.env` files, dependencies, build output,
coverage reports, and IDE project files are excluded by `.gitignore`.
