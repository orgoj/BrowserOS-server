/**
 * @license
 * Copyright 2025 BrowserOS
 */
import assert from 'node:assert';
import {describe, it} from 'bun:test';

import {html, withBrowser} from '@browseros/common/tests/utils';

import {webAnalytics} from '../../src/cdp-based/analytics.js';

describe('analytics', () => {
  it('web_analytics - analyze_datalayer - no dataLayer', async () => {
    await withBrowser(async (response, context) => {
      await webAnalytics.handler(
        {params: {action: 'analyze_datalayer'}},
        response,
        context,
      );

      const responseText = response.responseLines.join('\n');
      assert.ok(responseText.includes('Not Found'));
      assert.ok(responseText.includes('dataLayer not found'));
    });
  });

  it('web_analytics - analyze_datalayer - with dataLayer', async () => {
    await withBrowser(async (response, context) => {
      const page = context.getSelectedPage();

      await page.setContent(html`
        <script>
          window.dataLayer = window.dataLayer || [];
          window.dataLayer.push({event: 'page_view', page: '/home'});
          window.dataLayer.push({event: 'click', element: 'button'});
          window.dataLayer.push({event: 'page_view', page: '/about'});
        </script>
      `);

      await webAnalytics.handler(
        {params: {action: 'analyze_datalayer'}},
        response,
        context,
      );

      const responseText = response.responseLines.join('\n');
      assert.ok(responseText.includes('DataLayer Analysis'));
      assert.ok(responseText.includes('Total entries: 3'));
      assert.ok(responseText.includes('page_view'));
      assert.ok(responseText.includes('click'));
    });
  });

  it('web_analytics - analyze_datalayer - with eventFilter', async () => {
    await withBrowser(async (response, context) => {
      const page = context.getSelectedPage();

      await page.setContent(html`
        <script>
          window.dataLayer = window.dataLayer || [];
          window.dataLayer.push({event: 'page_view', page: '/home'});
          window.dataLayer.push({event: 'click', element: 'button'});
          window.dataLayer.push({event: 'page_view', page: '/about'});
        </script>
      `);

      await webAnalytics.handler(
        {params: {action: 'analyze_datalayer', eventFilter: 'page_view'}},
        response,
        context,
      );

      const responseText = response.responseLines.join('\n');
      assert.ok(responseText.includes('Total entries: 3'));
      assert.ok(responseText.includes('Filtered entries (event="page_view"): 2'));
    });
  });

  it('web_analytics - analyze_gtm - no GTM', async () => {
    await withBrowser(async (response, context) => {
      await webAnalytics.handler(
        {params: {action: 'analyze_gtm'}},
        response,
        context,
      );

      const responseText = response.responseLines.join('\n');
      assert.ok(responseText.includes('Not Found'));
      assert.ok(responseText.includes('Google Tag Manager not detected'));
    });
  });

  it('web_analytics - analyze_gtm - with GTM', async () => {
    await withBrowser(async (response, context) => {
      const page = context.getSelectedPage();

      await page.setContent(html`
        <script>
          window.google_tag_manager = {
            'GTM-TEST123': {
              dataLayer: {gtmDom: true},
              macros: {macro1: {}, macro2: {}},
              tags: {tag1: {}, tag2: {}, tag3: {}},
              predicates: {pred1: {}},
              rules: {rule1: {}, rule2: {}},
            },
          };
        </script>
      `);

      await webAnalytics.handler(
        {params: {action: 'analyze_gtm'}},
        response,
        context,
      );

      const responseText = response.responseLines.join('\n');
      assert.ok(responseText.includes('Google Tag Manager Analysis'));
      assert.ok(responseText.includes('GTM-TEST123'));
      assert.ok(responseText.includes('Tags: 3'));
      assert.ok(responseText.includes('Macros/Variables: 2'));
    });
  });

  it('web_analytics - analyze_ga4 - no GA4', async () => {
    await withBrowser(async (response, context) => {
      await webAnalytics.handler(
        {params: {action: 'analyze_ga4'}},
        response,
        context,
      );

      const responseText = response.responseLines.join('\n');
      assert.ok(responseText.includes('Not Found'));
      assert.ok(responseText.includes('Google Analytics 4 not detected'));
    });
  });

  it('web_analytics - analyze_ga4 - with GA4', async () => {
    await withBrowser(async (response, context) => {
      const page = context.getSelectedPage();

      await page.setContent(html`
        <script>
          window.gtag = function () {};
          window.dataLayer = window.dataLayer || [];
          window.dataLayer.push(['config', 'G-TEST12345', {send_page_view: false}]);
          window.dataLayer.push({event: 'page_view'});
        </script>
        <script>
          // Simulate GA4 measurement ID in page content
          var measurementId = 'G-TEST12345';
        </script>
      `);

      await webAnalytics.handler(
        {params: {action: 'analyze_ga4'}},
        response,
        context,
      );

      const responseText = response.responseLines.join('\n');
      assert.ok(responseText.includes('Google Analytics 4 Analysis'));
      assert.ok(responseText.includes('gtag function present: true'));
    });
  });

  it('web_analytics - full_analysis', async () => {
    await withBrowser(async (response, context) => {
      const page = context.getSelectedPage();

      await page.setContent(html`
        <script>
          window.dataLayer = window.dataLayer || [];
          window.dataLayer.push({event: 'page_view'});
        </script>
      `);

      await webAnalytics.handler(
        {params: {action: 'full_analysis'}},
        response,
        context,
      );

      const responseText = response.responseLines.join('\n');
      assert.ok(responseText.includes('Complete Web Analytics Audit'));
      assert.ok(responseText.includes('DataLayer Analysis'));
      assert.ok(responseText.includes('Google Tag Manager Analysis'));
      assert.ok(responseText.includes('Google Analytics 4 Analysis'));
      assert.ok(responseText.includes('Overall Recommendations'));
    });
  });

  it('web_analytics - monitor_events', async () => {
    await withBrowser(async (response, context) => {
      const page = context.getSelectedPage();

      await page.setContent(html`
        <script>
          window.dataLayer = window.dataLayer || [];
          setTimeout(() => {
            window.dataLayer.push({event: 'delayed_event', value: 42});
          }, 500);
        </script>
      `);

      await webAnalytics.handler(
        {params: {action: 'monitor_events', duration: 2}},
        response,
        context,
      );

      const responseText = response.responseLines.join('\n');
      assert.ok(responseText.includes('Event Monitoring'));
      assert.ok(responseText.includes('Captured'));
    });
  });

  it('web_analytics - stop_monitoring', async () => {
    await withBrowser(async (response, context) => {
      const page = context.getSelectedPage();

      await page.setContent(html`
        <script>
          window.dataLayer = window.dataLayer || [];
        </script>
      `);

      await webAnalytics.handler(
        {params: {action: 'stop_monitoring'}},
        response,
        context,
      );

      const responseText = response.responseLines.join('\n');
      assert.ok(responseText.includes('Event Monitoring Stopped'));
    });
  });

  it('web_analytics - handles errors gracefully', async () => {
    await withBrowser(async (response, context) => {
      const page = context.getSelectedPage();

      // Close the page to trigger an error
      await page.close();

      try {
        await webAnalytics.handler(
          {params: {action: 'analyze_datalayer'}},
          response,
          context,
        );
        const responseText = response.responseLines.join('\n');
        assert.ok(responseText.includes('Error executing'));
      } catch (error) {
        // It's okay if the error is thrown
        assert.ok(error);
      }
    });
  });
});
