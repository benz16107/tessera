// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { satteri } from '@astrojs/markdown-satteri';
import starlightLlmsTxt from 'starlight-llms-txt';
import { NAME, DESCRIPTION, SITE_URL, APP_URL } from './src/site.ts';

export default defineConfig({
  site: SITE_URL,
  trailingSlash: 'always',
  // Straight quotes and plain hyphens, exactly as written.
  markdown: { processor: satteri({ features: { smartPunctuation: false } }) },
  integrations: [
    starlight({
      title: NAME,
      description: DESCRIPTION,
      logo: { src: './src/assets/mark.svg', replacesTitle: false, alt: '' },
      favicon: '/favicon.svg',
      components: {
        Header: './src/components/Header.astro',
        ThemeProvider: './src/components/ThemeProvider.astro',
        ThemeSelect: './src/components/ThemeSelect.astro',
        Footer: './src/components/Footer.astro',
      },
      customCss: ['@fontsource-variable/archivo', '@fontsource/martian-mono/400.css', '@fontsource/martian-mono/500.css', './src/styles/tokens.css', './src/styles/ui.css', './src/styles/starlight.css'],
      lastUpdated: false,
      pagination: true,
      tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
      expressiveCode: {
        themes: ['github-dark'],
        styleOverrides: {
          borderRadius: '10px', borderColor: '#22211e', codeBackground: '#111110', codeFontFamily: 'var(--mono)', codeFontSize: '0.8125rem', uiFontFamily: 'var(--sans)',
          frames: { editorTabBarBackground: '#181816', editorActiveTabBackground: '#111110', editorActiveTabIndicatorTopColor: '#f2a33a', terminalTitlebarBackground: '#181816', terminalBackground: '#111110', frameBoxShadowCssValue: 'none', inlineButtonBackground: '#33312c' },
        },
        defaultProps: { overridesByLang: { 'sh,bash,shell,zsh,console': { frame: 'code' } } },
      },
      head: [
        { tag: 'meta', attrs: { name: 'theme-color', content: '#0b0b0a' } },
        { tag: 'meta', attrs: { property: 'og:image', content: `${SITE_URL}/og.jpg` } },
      ],
      plugins: [
        starlightLlmsTxt({
          projectName: NAME,
          description: DESCRIPTION,
          details: [
            `- The app is at ${APP_URL}. The demo shoot is session A9TVAN at the Manhattan Bridge view in DUMBO, Brooklyn.`,
            '- Every number on these pages was measured; "not measured" means exactly that.',
            '- Google Photorealistic 3D Tiles are display only in Tessera and never enter a render, an export or an AI step.',
          ].join('\n'),
          exclude: ['404'],
        }),
      ],
      sidebar: [
        { label: 'Tessera home', link: '/' },
        { label: 'Open the app', link: APP_URL, attrs: { rel: 'noopener' } },
        { label: 'Tracks', link: '/tracks/' },
        { label: 'Get started', items: ['docs/get-started', 'docs/why-tessera', 'docs/research'] },
        {
          label: 'How it works',
          items: [
            'docs/how-it-works/overview',
            'docs/how-it-works/solve',
            'docs/how-it-works/virtual-set',
            'docs/how-it-works/render',
            'docs/how-it-works/live-sync',
            'docs/how-it-works/messaging',
            'docs/how-it-works/geodata',
          ],
        },
        {
          label: 'Guides',
          items: [
            'docs/guides/place-people',
            'docs/guides/generate-a-prop',
            'docs/guides/look-through-the-camera',
            'docs/guides/plan-a-shoot-day',
            'docs/guides/scout-to-the-mark',
            'docs/guides/call-the-set',
          ],
        },
        {
          label: 'Reference',
          items: [
            'docs/reference/http-api',
            'docs/reference/spacetimedb',
            { label: 'Lens catalog', link: '/docs/reference/lens-catalog/' },
          ],
        },
        {
          label: 'Project',
          items: [
            { label: 'Credits and licenses', link: '/credits/' },
            'privacy',
            'terms',
          ],
        },
      ],
    }),
  ],
});
