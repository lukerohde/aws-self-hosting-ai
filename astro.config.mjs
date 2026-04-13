import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

// site URL is set by /setup to match your domain
export default defineConfig({
  site: 'https://DOMAIN_PLACEHOLDER',
  integrations: [mdx(), sitemap()],
  output: 'static',
});
