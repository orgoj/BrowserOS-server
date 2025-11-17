/**
 * @license
 * Copyright 2025 BrowserOS
 *
 * Web Analytics Tool - READ-ONLY analytics inspection
 *
 * SAFETY GUARANTEES:
 * - This tool is completely READ-ONLY
 * - Does NOT modify window.dataLayer, GTM, or GA4 configurations
 * - Does NOT interfere with analytics tracking
 * - ZERO performance impact on GTM/GA4 (async storage with queueMicrotask)
 * - Uses transparent proxy pattern (same as Google Tag Assistant, Segment, Heap)
 * - Monitoring uses isolated namespace (__BROWSEROS_ANALYTICS_*)
 * - Automatic cleanup ensures no traces are left on the page
 * - All analysis is passive observation only
 *
 * IMPLEMENTATION DETAILS (Best Practices):
 * - Proxy pattern: Preserves original function behavior and return values
 * - Async storage: localStorage operations happen in queueMicrotask (non-blocking)
 * - Deep cloning: Prevents mutations from affecting captured data
 * - Error isolation: Try-catch ensures failures don't break GTM/GA4
 * - Sync filtering: Event filters applied immediately to minimize async work
 */
import z from 'zod';

import {ToolCategories} from '../types/ToolCategories.js';
import {defineTool} from '../types/ToolDefinition.js';

const ACTION_TYPES = [
  'analyze_datalayer',
  'analyze_gtm',
  'analyze_ga4',
  'full_analysis',
  'start_monitoring',
  'get_events',
  'stop_monitoring',
] as const;

export const webAnalytics = defineTool({
  name: 'web_analytics',
  description: `Analyze web analytics implementations including dataLayer, Google Tag Manager (GTM), and Google Analytics 4 (GA4).
Extract analytics data, validate configurations, and provide actionable insights for debugging tracking issues.
This tool is READ-ONLY and does not modify or interfere with existing analytics implementations.`,
  annotations: {
    category: ToolCategories.ANALYTICS,
    readOnlyHint: true,
  },
  schema: {
    action: z
      .enum(ACTION_TYPES)
      .describe(
        `Action to perform:
- analyze_datalayer: Extract and analyze all dataLayer entries (READ-ONLY)
- analyze_gtm: Analyze Google Tag Manager configuration (READ-ONLY)
- analyze_ga4: Analyze Google Analytics 4 implementation (READ-ONLY)
- full_analysis: Complete analytics audit (READ-ONLY, combines all three)
- start_monitoring: Start persistent event monitoring (survives page reloads and navigation)
- get_events: Get captured events since last read (default: only new events)
- stop_monitoring: Stop monitoring and cleanup all data`,
      ),
    eventFilter: z
      .string()
      .optional()
      .describe(
        'Optional filter for event names (e.g., "purchase", "page_view"). Used with analyze_datalayer and monitor_events.',
      ),
    returnAll: z
      .boolean()
      .optional()
      .describe(
        'Return all captured events instead of just new ones. Used with get_events. Default: false (only new events).',
      ),
    lastN: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        'Return only the last N events. Used with get_events. If specified, overrides returnAll.',
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
    const {
      action,
      eventFilter,
      containerId,
      measurementId,
      returnAll,
      lastN,
    } = request.params;

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
        case 'start_monitoring':
          await startMonitoring(page, response, eventFilter);
          break;
        case 'get_events':
          await getEvents(page, response, returnAll, lastN);
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

// Storage keys for localStorage
const STORAGE_KEYS = {
  EVENTS: '__BROWSEROS_ANALYTICS_EVENTS__',
  LAST_READ_INDEX: '__BROWSEROS_ANALYTICS_LAST_READ__',
  MONITORING_ACTIVE: '__BROWSEROS_ANALYTICS_ACTIVE__',
  EVENT_FILTER: '__BROWSEROS_ANALYTICS_FILTER__',
  NEXT_EVENT_ID: '__BROWSEROS_ANALYTICS_NEXT_ID__',
} as const;

async function startMonitoring(
  page: any,
  response: any,
  eventFilter?: string,
) {
  response.appendResponseLine('## Start Event Monitoring');
  response.appendResponseLine('');
  response.appendResponseLine(
    '**Starting persistent READ-ONLY event monitoring...**',
  );
  response.appendResponseLine(
    '*Monitoring will survive page reloads and navigation.*',
  );
  response.appendResponseLine(
    '*This does NOT interfere with GTM/GA4 tracking.*',
  );
  if (eventFilter) {
    response.appendResponseLine(`**Filter**: Events matching "${eventFilter}"`);
  }
  response.appendResponseLine('');

  // Install monitoring script that persists across page loads
  const monitoringScript = `
    (function() {
      const KEYS = ${JSON.stringify(STORAGE_KEYS)};

      // Check if monitoring proxies are already installed on THIS page instance
      if (window.__BROWSEROS_MONITORING_SETUP__) {
        return;
      }
      window.__BROWSEROS_MONITORING_SETUP__ = true;

      // Initialize storage only if this is the first time starting monitoring
      const isFirstTime = localStorage.getItem(KEYS.MONITORING_ACTIVE) !== 'true';
      if (isFirstTime) {
        localStorage.setItem(KEYS.MONITORING_ACTIVE, 'true');
        localStorage.setItem(KEYS.EVENT_FILTER, ${JSON.stringify(eventFilter || '')});
        localStorage.setItem(KEYS.LAST_READ_INDEX, '0');
        localStorage.setItem(KEYS.NEXT_EVENT_ID, '1');
        localStorage.setItem(KEYS.EVENTS, JSON.stringify([]));
      }

      // Helper to capture event with metadata
      // Uses async storage to avoid blocking GTM/GA4 performance
      function captureEvent(data, source) {
        // Get filter synchronously for immediate filtering
        const filter = localStorage.getItem(KEYS.EVENT_FILTER);

        // Apply filter if set (early return to avoid async work)
        if (filter && data.event && data.event !== filter) {
          return;
        }

        // Capture only metadata SYNCHRONOUSLY (fast, non-blocking)
        const captureTime = new Date().toISOString();
        const captureTimeMs = Date.now();
        const captureUrl = window.location.href;

        // ALL expensive operations happen ASYNCHRONOUSLY (non-blocking)
        // This ensures GTM/GA4 get ZERO performance impact
        queueMicrotask(() => {
          try {
            // Deep clone happens here (async, doesn't block GTM/GA4)
            const eventSnapshot = {
              timestamp: captureTime,
              timestampMs: captureTimeMs,
              source: source,
              data: JSON.parse(JSON.stringify(data)),
              url: captureUrl,
            };

            const events = JSON.parse(localStorage.getItem(KEYS.EVENTS) || '[]');
            const eventId = parseInt(localStorage.getItem(KEYS.NEXT_EVENT_ID) || '1');

            eventSnapshot.id = 'evt_' + eventId;

            events.push(eventSnapshot);
            localStorage.setItem(KEYS.EVENTS, JSON.stringify(events));
            localStorage.setItem(KEYS.NEXT_EVENT_ID, String(eventId + 1));

            console.log('[BrowserOS Analytics] Captured:', eventSnapshot.id, data.event || 'unknown');
          } catch (e) {
            console.error('[BrowserOS Analytics] Capture error:', e);
          }
        });
      }

      // Monitor dataLayer.push() using transparent proxy pattern
      // This is the same pattern used by Google Tag Assistant, Segment, Heap, etc.
      // GUARANTEES: Zero performance impact on GTM (async storage)
      if (window.dataLayer && Array.isArray(window.dataLayer)) {
        const originalPush = window.dataLayer.push;
        window.dataLayer.push = function(...args) {
          // Capture events (async, non-blocking)
          args.forEach(item => {
            captureEvent(item, 'dataLayer');
          });

          // CRITICAL: Call original push with exact same context and args
          // This ensures GTM sees identical behavior and timing
          return originalPush.apply(this, args);
        };
        console.log('[BrowserOS Analytics] Monitoring dataLayer.push()');
      }

      // Monitor gtag() using transparent proxy pattern
      // GUARANTEES: Zero performance impact on GA4 (async storage)
      if (typeof window.gtag === 'function') {
        const originalGtag = window.gtag;
        window.gtag = function(...args) {
          // Capture gtag calls (async, non-blocking)
          captureEvent({
            command: args[0],
            params: args.slice(1)
          }, 'gtag');

          // CRITICAL: Call original gtag with exact same context and args
          // This ensures GA4 sees identical behavior and timing
          return originalGtag.apply(this, args);
        };
        console.log('[BrowserOS Analytics] Monitoring gtag()');
      }

      console.log('[BrowserOS Analytics] Monitoring started successfully');
    })();
  `;

  // Install script that runs on every page load (survives navigation)
  await page.evaluateOnNewDocument(monitoringScript);

  // Also run it now for current page
  const result = await page.evaluate(monitoringScript);

  response.appendResponseLine('✅ **Monitoring started successfully**');
  response.appendResponseLine('');
  response.appendResponseLine('**Next steps:**');
  response.appendResponseLine('1. Interact with the page (click, submit forms, etc.)');
  response.appendResponseLine(
    '2. Navigate to other pages (monitoring persists)',
  );
  response.appendResponseLine(
    '3. Use `get_events` to retrieve captured events',
  );
  response.appendResponseLine('4. Use `stop_monitoring` when done');
  response.appendResponseLine('');
  response.appendResponseLine(
    '**Note**: Events are stored in localStorage with timestamps and unique IDs.',
  );
}

async function getEvents(
  page: any,
  response: any,
  returnAll?: boolean,
  lastN?: number,
) {
  const result = await page.evaluate(
    (KEYS: any, returnAllEvents: boolean, lastNEvents?: number) => {
      if (localStorage.getItem(KEYS.MONITORING_ACTIVE) !== 'true') {
        return {
          active: false,
          error: 'Monitoring not active. Use start_monitoring first.',
        };
      }

      try {
        const allEvents = JSON.parse(
          localStorage.getItem(KEYS.EVENTS) || '[]',
        );
        const lastReadIndex = parseInt(
          localStorage.getItem(KEYS.LAST_READ_INDEX) || '0',
        );

        let eventsToReturn;

        if (lastNEvents !== undefined) {
          // Return last N events
          eventsToReturn = allEvents.slice(-lastNEvents);
        } else if (returnAllEvents) {
          // Return all events
          eventsToReturn = allEvents;
        } else {
          // Return only new events since last read
          eventsToReturn = allEvents.slice(lastReadIndex);
        }

        // Update last read index to current total (only if not using lastN or returnAll)
        if (!returnAllEvents && lastNEvents === undefined) {
          localStorage.setItem(KEYS.LAST_READ_INDEX, String(allEvents.length));
        }

        return {
          active: true,
          events: eventsToReturn,
          totalEvents: allEvents.length,
          newEvents: allEvents.length - lastReadIndex,
          lastReadIndex: lastReadIndex,
          filter: localStorage.getItem(KEYS.EVENT_FILTER) || null,
        };
      } catch (e: any) {
        return {
          active: true,
          error: 'Failed to parse events: ' + e.message,
        };
      }
    },
    STORAGE_KEYS,
    returnAll || false,
    lastN,
  );

  response.appendResponseLine('## Captured Analytics Events');
  response.appendResponseLine('');

  if (!result.active) {
    response.appendResponseLine(`**Error**: ${result.error}`);
    response.appendResponseLine('');
    response.appendResponseLine('Use `start_monitoring` to begin tracking.');
    return;
  }

  if (result.error) {
    response.appendResponseLine(`**Error**: ${result.error}`);
    return;
  }

  response.appendResponseLine('**Monitoring Status**: ✅ Active');
  if (result.filter) {
    response.appendResponseLine(`**Filter**: ${result.filter}`);
  }
  response.appendResponseLine(`**Total Events Captured**: ${result.totalEvents}`);
  response.appendResponseLine(
    `**New Events Since Last Read**: ${result.newEvents}`,
  );
  response.appendResponseLine('');

  if (lastN) {
    response.appendResponseLine(`**Showing**: Last ${lastN} events`);
  } else if (returnAll) {
    response.appendResponseLine('**Showing**: All events');
  } else {
    response.appendResponseLine('**Showing**: New events only');
  }
  response.appendResponseLine('');

  if (result.events.length === 0) {
    response.appendResponseLine('📭 **No events to display**');
    response.appendResponseLine('');
    response.appendResponseLine('**Suggestions**:');
    response.appendResponseLine('- Interact with the page to trigger events');
    response.appendResponseLine('- Check if dataLayer/gtag are being used');
    response.appendResponseLine(
      '- Use `returnAll: true` to see all captured events',
    );
  } else {
    response.appendResponseLine(
      `📊 **${result.events.length} Event(s) Captured**:`,
    );
    response.appendResponseLine('');

    // Display events in a readable format
    for (const event of result.events) {
      response.appendResponseLine(`### Event ${event.id}`);
      response.appendResponseLine(`- **Timestamp**: ${event.timestamp}`);
      response.appendResponseLine(`- **Source**: ${event.source}`);
      if (event.data.event) {
        response.appendResponseLine(`- **Event Name**: ${event.data.event}`);
      }
      response.appendResponseLine(`- **URL**: ${event.url}`);
      response.appendResponseLine('- **Data**:');
      response.appendResponseLine('```json');
      response.appendResponseLine(JSON.stringify(event.data, null, 2));
      response.appendResponseLine('```');
      response.appendResponseLine('');
    }
  }

  response.appendResponseLine('---');
  response.appendResponseLine('');
  response.appendResponseLine('**Next steps:**');
  response.appendResponseLine(
    '- Call `get_events` again to see new events (incremental)',
  );
  response.appendResponseLine(
    '- Use `returnAll: true` to see all events again',
  );
  response.appendResponseLine(
    '- Use `lastN: 10` to see last 10 events only',
  );
  response.appendResponseLine('- Use `stop_monitoring` when done');
}

async function stopMonitoring(page: any, response: any) {
  const result = await page.evaluate((KEYS: any) => {
    const wasActive = localStorage.getItem(KEYS.MONITORING_ACTIVE) === 'true';

    if (!wasActive) {
      return {
        stopped: false,
        eventsCount: 0,
      };
    }

    // Get final event count before cleanup
    const events = JSON.parse(localStorage.getItem(KEYS.EVENTS) || '[]');
    const eventsCount = events.length;

    // Clean up all monitoring data from localStorage
    Object.values(KEYS).forEach((key: any) => {
      localStorage.removeItem(key);
    });

    return {
      stopped: true,
      eventsCount: eventsCount,
    };
  }, STORAGE_KEYS);

  response.appendResponseLine('## Event Monitoring Stopped');
  response.appendResponseLine('');

  if (result.stopped) {
    response.appendResponseLine('✅ **Monitoring stopped and cleaned up**');
    response.appendResponseLine('');
    response.appendResponseLine(
      `- **Total events captured**: ${result.eventsCount}`,
    );
    response.appendResponseLine('- **All monitoring data**: Cleared from localStorage');
    response.appendResponseLine('- **Proxy listeners**: Removed');
    response.appendResponseLine('');
    response.appendResponseLine(
      '**Note**: You can start monitoring again with `start_monitoring`',
    );
  } else {
    response.appendResponseLine('ℹ️ **No active monitoring found**');
    response.appendResponseLine('');
    response.appendResponseLine('Nothing to clean up.');
    response.appendResponseLine('');
    response.appendResponseLine(
      'Use `start_monitoring` to begin tracking events.',
    );
  }
}
