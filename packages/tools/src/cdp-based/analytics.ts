/**
 * @license
 * Copyright 2025 BrowserOS
 */
import z from 'zod';

import {ToolCategories} from '../types/ToolCategories.js';
import {defineTool} from '../types/ToolDefinition.js';

const ACTION_TYPES = [
  'analyze_datalayer',
  'analyze_gtm',
  'analyze_ga4',
  'full_analysis',
  'monitor_events',
  'stop_monitoring',
] as const;

export const webAnalytics = defineTool({
  name: 'web_analytics',
  description: `Analyze web analytics implementations including dataLayer, Google Tag Manager (GTM), and Google Analytics 4 (GA4).
Extract analytics data, validate configurations, and provide actionable insights for debugging tracking issues.`,
  annotations: {
    category: ToolCategories.ANALYTICS,
    readOnlyHint: true,
  },
  schema: {
    action: z
      .enum(ACTION_TYPES)
      .describe(
        `Action to perform:
- analyze_datalayer: Extract and analyze all dataLayer entries
- analyze_gtm: Analyze Google Tag Manager configuration
- analyze_ga4: Analyze Google Analytics 4 implementation
- full_analysis: Complete analytics audit (dataLayer + GTM + GA4)
- monitor_events: Real-time monitoring of dataLayer/GA4 events
- stop_monitoring: Stop active event monitoring`,
      ),
    eventFilter: z
      .string()
      .optional()
      .describe(
        'Optional filter for event names (e.g., "purchase", "page_view"). Used with analyze_datalayer and monitor_events.',
      ),
    duration: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        'Duration in seconds for event monitoring. Used with monitor_events. Default: 30 seconds.',
      ),
    containerId: z
      .string()
      .optional()
      .describe(
        'Optional GTM container ID to focus on (e.g., "GTM-XXXXX"). Used with analyze_gtm.',
      ),
    measurementId: z
      .string()
      .optional()
      .describe(
        'Optional GA4 measurement ID to focus on (e.g., "G-XXXXXXXXXX"). Used with analyze_ga4.',
      ),
  },
  handler: async (request, response, context) => {
    const page = context.getSelectedPage();
    const {action, eventFilter, duration, containerId, measurementId} =
      request.params;

    try {
      switch (action) {
        case 'analyze_datalayer':
          await analyzeDataLayer(page, response, eventFilter);
          break;
        case 'analyze_gtm':
          await analyzeGTM(page, response, containerId);
          break;
        case 'analyze_ga4':
          await analyzeGA4(page, response, measurementId);
          break;
        case 'full_analysis':
          await fullAnalysis(page, response);
          break;
        case 'monitor_events':
          await monitorEvents(page, response, context, eventFilter, duration);
          break;
        case 'stop_monitoring':
          await stopMonitoring(page, response);
          break;
      }
    } catch (error) {
      response.appendResponseLine(
        `Error executing ${action}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});

async function analyzeDataLayer(
  page: any,
  response: any,
  eventFilter?: string,
) {
  const result = await page.evaluate(
    (filter: string | undefined) => {
      const w = window as any;
      if (!w.dataLayer || !Array.isArray(w.dataLayer)) {
        return {
          found: false,
          error: 'dataLayer not found or not an array',
        };
      }

      const dataLayer = w.dataLayer;
      const filtered = filter
        ? dataLayer.filter((entry: any) => entry.event === filter)
        : dataLayer;

      const eventTypes = new Map<string, number>();
      const errors: string[] = [];

      dataLayer.forEach((entry: any, idx: number) => {
        if (entry.event) {
          eventTypes.set(entry.event, (eventTypes.get(entry.event) || 0) + 1);
        }
        if (entry['gtm.uniqueEventId'] === undefined && entry.event) {
          errors.push(
            `Entry ${idx}: Event "${entry.event}" missing GTM unique event ID`,
          );
        }
      });

      return {
        found: true,
        totalEntries: dataLayer.length,
        filteredEntries: filtered.length,
        eventTypes: Object.fromEntries(eventTypes),
        data: filtered,
        errors,
      };
    },
    eventFilter,
  );

  if (!result.found) {
    response.appendResponseLine('## DataLayer Analysis');
    response.appendResponseLine('');
    response.appendResponseLine(`**Status**: Not Found`);
    response.appendResponseLine(`**Error**: ${result.error}`);
    response.appendResponseLine('');
    response.appendResponseLine(
      '**Recommendation**: Ensure Google Tag Manager or a dataLayer implementation is loaded on this page.',
    );
    return;
  }

  response.appendResponseLine('## DataLayer Analysis');
  response.appendResponseLine('');
  response.appendResponseLine('### Summary');
  response.appendResponseLine(`- Total entries: ${result.totalEntries}`);
  if (eventFilter) {
    response.appendResponseLine(
      `- Filtered entries (event="${eventFilter}"): ${result.filteredEntries}`,
    );
  }
  response.appendResponseLine('');

  response.appendResponseLine('### Event Types');
  for (const [event, count] of Object.entries(result.eventTypes)) {
    response.appendResponseLine(`- ${event}: ${count} occurrence(s)`);
  }
  response.appendResponseLine('');

  if (result.errors.length > 0) {
    response.appendResponseLine('### Issues Detected');
    for (const error of result.errors) {
      response.appendResponseLine(`- ${error}`);
    }
    response.appendResponseLine('');
  }

  response.appendResponseLine('### DataLayer Entries');
  response.appendResponseLine('```json');
  response.appendResponseLine(JSON.stringify(result.data, null, 2));
  response.appendResponseLine('```');
  response.appendResponseLine('');

  if (result.errors.length === 0) {
    response.appendResponseLine('### Recommendations');
    response.appendResponseLine('- DataLayer appears to be configured correctly');
    response.appendResponseLine(
      '- Consider validating event schemas match your tracking plan',
    );
  }
}

async function analyzeGTM(page: any, response: any, containerId?: string) {
  const result = await page.evaluate((targetContainerId: string | undefined) => {
    const w = window as any;
    if (!w.google_tag_manager) {
      return {
        found: false,
        error: 'Google Tag Manager not detected',
      };
    }

    const gtm = w.google_tag_manager;
    const containers = Object.keys(gtm).filter(key => key.startsWith('GTM-'));

    if (containers.length === 0) {
      return {
        found: false,
        error: 'No GTM containers found',
      };
    }

    const analyzeContainer = (containerId: string) => {
      const container = gtm[containerId];
      if (!container) return null;

      return {
        containerId,
        dataLayer: container.dataLayer?.gtmDom ? 'Available' : 'Not available',
        macros: Object.keys(container.macros || {}).length,
        tags: Object.keys(container.tags || {}).length,
        predicates: Object.keys(container.predicates || {}).length,
        rules: Object.keys(container.rules || {}).length,
      };
    };

    const targetContainer = targetContainerId || containers[0];
    const containerData = analyzeContainer(targetContainer);

    return {
      found: true,
      containers,
      activeContainer: targetContainer,
      data: containerData,
      allContainers: containers.map(id => analyzeContainer(id)),
    };
  }, containerId);

  if (!result.found) {
    response.appendResponseLine('## Google Tag Manager Analysis');
    response.appendResponseLine('');
    response.appendResponseLine(`**Status**: Not Found`);
    response.appendResponseLine(`**Error**: ${result.error}`);
    response.appendResponseLine('');
    response.appendResponseLine(
      '**Recommendation**: Ensure Google Tag Manager is properly installed on this page.',
    );
    return;
  }

  response.appendResponseLine('## Google Tag Manager Analysis');
  response.appendResponseLine('');
  response.appendResponseLine('### Summary');
  response.appendResponseLine(
    `- Containers detected: ${result.containers.join(', ')}`,
  );
  response.appendResponseLine(
    `- Analyzing container: ${result.activeContainer}`,
  );
  response.appendResponseLine('');

  if (result.data) {
    response.appendResponseLine('### Container Configuration');
    response.appendResponseLine(`- DataLayer: ${result.data.dataLayer}`);
    response.appendResponseLine(`- Macros/Variables: ${result.data.macros}`);
    response.appendResponseLine(`- Tags: ${result.data.tags}`);
    response.appendResponseLine(`- Predicates: ${result.data.predicates}`);
    response.appendResponseLine(`- Rules/Triggers: ${result.data.rules}`);
    response.appendResponseLine('');
  }

  response.appendResponseLine('### All Containers');
  response.appendResponseLine('```json');
  response.appendResponseLine(JSON.stringify(result.allContainers, null, 2));
  response.appendResponseLine('```');
  response.appendResponseLine('');

  response.appendResponseLine('### Recommendations');
  response.appendResponseLine('- GTM is properly loaded');
  response.appendResponseLine(
    '- Use GTM Preview mode to debug tag firing in real-time',
  );
  response.appendResponseLine(
    '- Verify tags are firing on expected triggers using analyze_datalayer',
  );
}

async function analyzeGA4(page: any, response: any, measurementId?: string) {
  const result = await page.evaluate((targetMeasurementId: string | undefined) => {
    const w = window as any;

    const ga4Data = {
      found: false,
      measurementIds: [] as string[],
      gtagPresent: false,
      gtag_config: {} as any,
      dataLayerEvents: [] as any[],
    };

    if (typeof w.gtag === 'function') {
      ga4Data.gtagPresent = true;
    }

    if (w.dataLayer && Array.isArray(w.dataLayer)) {
      const configEntries = w.dataLayer.filter(
        (entry: any) => entry[0] === 'config' || entry.event === 'gtm.js',
      );

      const measurementIdPattern = /G-[A-Z0-9]+/g;
      const pageContent = document.documentElement.innerHTML;
      const matches = pageContent.match(measurementIdPattern);

      if (matches) {
        ga4Data.measurementIds = [...new Set(matches)];
        ga4Data.found = true;
      }

      ga4Data.dataLayerEvents = w.dataLayer
        .filter((entry: any) => entry.event)
        .map((entry: any) => ({
          event: entry.event,
          timestamp: entry['gtm.start'] || 'N/A',
          params: {...entry},
        }));

      for (const entry of configEntries) {
        if (entry[1] && entry[1].startsWith('G-')) {
          ga4Data.gtag_config[entry[1]] = entry[2] || {};
        }
      }
    }

    if (!ga4Data.found && !ga4Data.gtagPresent) {
      return {
        found: false,
        error: 'Google Analytics 4 not detected',
      };
    }

    const targetId = targetMeasurementId || ga4Data.measurementIds[0];

    return {
      found: true,
      gtagPresent: ga4Data.gtagPresent,
      measurementIds: ga4Data.measurementIds,
      activeMeasurementId: targetId,
      config: ga4Data.gtag_config[targetId] || {},
      allConfigs: ga4Data.gtag_config,
      recentEvents: ga4Data.dataLayerEvents.slice(-10),
      totalEvents: ga4Data.dataLayerEvents.length,
    };
  }, measurementId);

  if (!result.found) {
    response.appendResponseLine('## Google Analytics 4 Analysis');
    response.appendResponseLine('');
    response.appendResponseLine(`**Status**: Not Found`);
    response.appendResponseLine(`**Error**: ${result.error}`);
    response.appendResponseLine('');
    response.appendResponseLine(
      '**Recommendation**: Ensure GA4 is properly installed with gtag.js or via GTM.',
    );
    return;
  }

  response.appendResponseLine('## Google Analytics 4 Analysis');
  response.appendResponseLine('');
  response.appendResponseLine('### Summary');
  response.appendResponseLine(`- gtag function present: ${result.gtagPresent}`);
  response.appendResponseLine(
    `- Measurement IDs detected: ${result.measurementIds.join(', ') || 'None'}`,
  );
  if (result.activeMeasurementId) {
    response.appendResponseLine(
      `- Analyzing: ${result.activeMeasurementId}`,
    );
  }
  response.appendResponseLine(`- Total events tracked: ${result.totalEvents}`);
  response.appendResponseLine('');

  if (result.activeMeasurementId && result.config) {
    response.appendResponseLine('### GA4 Configuration');
    response.appendResponseLine('```json');
    response.appendResponseLine(JSON.stringify(result.config, null, 2));
    response.appendResponseLine('```');
    response.appendResponseLine('');
  }

  response.appendResponseLine('### Recent Events (Last 10)');
  response.appendResponseLine('```json');
  response.appendResponseLine(JSON.stringify(result.recentEvents, null, 2));
  response.appendResponseLine('```');
  response.appendResponseLine('');

  response.appendResponseLine('### All Measurement Configs');
  response.appendResponseLine('```json');
  response.appendResponseLine(JSON.stringify(result.allConfigs, null, 2));
  response.appendResponseLine('```');
  response.appendResponseLine('');

  response.appendResponseLine('### Recommendations');
  if (!result.gtagPresent) {
    response.appendResponseLine(
      '- WARNING: gtag function not detected, GA4 may not be firing correctly',
    );
  } else {
    response.appendResponseLine('- GA4 appears to be configured correctly');
  }
  response.appendResponseLine(
    '- Use browser DevTools Network tab to verify hits are being sent to google-analytics.com/g/collect',
  );
  response.appendResponseLine(
    '- Check GA4 DebugView for real-time event validation',
  );
}

async function fullAnalysis(page: any, response: any) {
  response.appendResponseLine('# Complete Web Analytics Audit');
  response.appendResponseLine('');
  response.appendResponseLine(
    'This report provides a comprehensive analysis of all analytics implementations on the current page.',
  );
  response.appendResponseLine('');
  response.appendResponseLine('---');
  response.appendResponseLine('');

  await analyzeDataLayer(page, response, undefined);
  response.appendResponseLine('');
  response.appendResponseLine('---');
  response.appendResponseLine('');

  await analyzeGTM(page, response, undefined);
  response.appendResponseLine('');
  response.appendResponseLine('---');
  response.appendResponseLine('');

  await analyzeGA4(page, response, undefined);
  response.appendResponseLine('');
  response.appendResponseLine('---');
  response.appendResponseLine('');

  response.appendResponseLine('## Overall Recommendations');
  response.appendResponseLine('');
  response.appendResponseLine(
    '1. **Test your tracking**: Use GTM Preview mode and GA4 DebugView',
  );
  response.appendResponseLine(
    '2. **Validate events**: Ensure all critical events are firing correctly',
  );
  response.appendResponseLine(
    '3. **Monitor errors**: Check browser console for tracking errors',
  );
  response.appendResponseLine(
    '4. **Document tracking**: Maintain a tracking plan for all events',
  );
  response.appendResponseLine(
    '5. **Regular audits**: Run this analysis periodically to catch issues',
  );
}

async function monitorEvents(
  page: any,
  response: any,
  context: any,
  eventFilter?: string,
  duration?: number,
) {
  const monitorDuration = duration || 30;

  response.appendResponseLine('## Event Monitoring');
  response.appendResponseLine('');
  response.appendResponseLine(
    `Starting real-time event monitoring for ${monitorDuration} seconds...`,
  );
  if (eventFilter) {
    response.appendResponseLine(`Filter: Events matching "${eventFilter}"`);
  }
  response.appendResponseLine('');

  const setupResult = await page.evaluate(
    (filter: string | undefined) => {
      const w = window as any;
      if (!w.dataLayer || !Array.isArray(w.dataLayer)) {
        return {success: false, error: 'dataLayer not found'};
      }

      w._analyticsMonitor = {
        events: [],
        startLength: w.dataLayer.length,
        filter,
      };

      return {success: true};
    },
    eventFilter,
  );

  if (!setupResult.success) {
    response.appendResponseLine(`**Error**: ${setupResult.error}`);
    return;
  }

  await new Promise(resolve => setTimeout(resolve, monitorDuration * 1000));

  const events = await page.evaluate(() => {
    const w = window as any;
    if (!w._analyticsMonitor || !w.dataLayer) {
      return [];
    }

    const monitor = w._analyticsMonitor;
    const newEntries = w.dataLayer.slice(monitor.startLength);

    const filtered = monitor.filter
      ? newEntries.filter((entry: any) => entry.event === monitor.filter)
      : newEntries;

    delete w._analyticsMonitor;
    return filtered;
  });

  response.appendResponseLine(`**Captured ${events.length} event(s)**`);
  response.appendResponseLine('');

  if (events.length > 0) {
    response.appendResponseLine('### Captured Events');
    response.appendResponseLine('```json');
    response.appendResponseLine(JSON.stringify(events, null, 2));
    response.appendResponseLine('```');
  } else {
    response.appendResponseLine('No events captured during monitoring period.');
    response.appendResponseLine('');
    response.appendResponseLine('**Suggestions**:');
    response.appendResponseLine(
      '- Interact with the page to trigger events',
    );
    response.appendResponseLine('- Increase monitoring duration');
    response.appendResponseLine('- Check if events are being pushed to dataLayer');
  }
}

async function stopMonitoring(page: any, response: any) {
  await page.evaluate(() => {
    const w = window as any;
    if (w._analyticsMonitor) {
      delete w._analyticsMonitor;
      return true;
    }
    return false;
  });

  response.appendResponseLine('## Event Monitoring Stopped');
  response.appendResponseLine('');
  response.appendResponseLine(
    'Event monitoring has been stopped and cleanup completed.',
  );
}
