import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewEncapsulation,
} from '@angular/core';
import {Router} from '@angular/router';
import {take} from 'rxjs/operators';
import {IdleMonitorService} from '../idleMonitor/idle-monitor.service';
import {ScullyRoutesService} from '../route-service/scully-routes.service';
import {fetchHttp} from '../utils/fetchHttp';
import {findComments} from '../utils/findComments';

interface ScullyContent {
  html: string;
  cssId: string;
}
declare global {
  interface Window {
    scullyContent: ScullyContent;
  }
}
/** this is needed, because otherwise the CLI borks while building */
const scullyBegin = '<!--scullyContent-begin-->';
const scullyEnd = '<!--scullyContent-end-->';
@Component({
  // tslint:disable-next-line: component-selector
  selector: 'scully-content',
  template: '<ng-content></ng-content>',
  styles: [
    `
      :host {
        display: none;
      }
      scully-content {
        display: none;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  preserveWhitespaces: true,
})
export class ScullyContentComponent implements OnInit, OnDestroy {
  elm = this.elmRef.nativeElement as HTMLElement;
  /** pull in all  available routes into an eager promise */
  routes = this.srs.available$.pipe(take(1)).toPromise();

  constructor(private elmRef: ElementRef, private srs: ScullyRoutesService, private router: Router) {}

  ngOnInit() {
    // /** make sure the idle-check is loaded. */
    // this.idle.init();
    if (this.elm) {
      /** this will only fire in a browser environment */
      this.handlePage();
    }
  }

  /**
   * Loads the static content from scully into the view
   * Will fetch the content from sibling links with xmlHTTPrequest
   */
  private async handlePage() {
    const template = document.createElement('template');
    const currentCssId = this.getCSSId(this.elm);
    if (window.scullyContent) {
      /** upgrade existing static content */
      const htmlString = window.scullyContent.html;
      if (currentCssId !== window.scullyContent.cssId) {
        /** replace the angular cssId */
        template.innerHTML = htmlString.split(window.scullyContent.cssId).join(currentCssId);
      } else {
        template.innerHTML = htmlString;
      }
    } else {
      const curPage = location.href;
      /**
       *   NOTE
       * when updateting the texts for the errors, make sure you leave the
       *  `id="___scully-parsing-error___"`
       * in there. That way users can detect rendering errors in their CI
       * on a reliable way.
       */
      await fetchHttp(curPage, 'text')
        .then((html: string) => {
          try {
            const htmlString = html.split(scullyBegin)[1].split(scullyEnd)[0];
            if (htmlString.includes('_ngcontent')) {
              /** update the angular cssId */
              const atr = '_ngcontent' + htmlString.split('_ngcontent')[1].split('=')[0];
              template.innerHTML = htmlString.split(atr).join(currentCssId);
            }
          } catch (e) {
            template.innerHTML = `<h2 id="___scully-parsing-error___">Sorry, could not parse static page content</h2>
            <p>This might happen if you are not using the static generated pages.</p>`;
          }
        })
        .catch(e => {
          template.innerHTML =
            '<h2 id="___scully-parsing-error___">Sorry, could not load static page content</h2>';
          console.error('problem during loading static scully content', e);
        });
    }
    /** insert the whole thing just before the `<scully-content>` element */
    const parent = this.elm.parentElement || document.body;
    const begin = document.createComment('scullyContent-begin');
    const end = document.createComment('scullyContent-end');
    parent.insertBefore(begin, this.elm);
    parent.insertBefore(template.content, this.elm);
    parent.insertBefore(end, this.elm);
    /** upgrade all hrefs to simulated routelinks  */
    document.querySelectorAll('[href]').forEach(this.upgradeToRoutelink.bind(this));
  }

  /**
   * upgrade a **href** attributes to links that respect the Angular router
   * and don't do a full page reload. Only works on links that are found in the
   * Scully route config file.
   * @param elm the element containing the **hrefs**
   */
  async upgradeToRoutelink(elm: HTMLElement) {
    const routes = await this.routes;
    const lnk = elm.getAttribute('href').toLowerCase();
    const route = routes.find(r => r.route.toLowerCase() === lnk);
    /** only upgrade routes known by scully. */
    if (lnk && route) {
      elm.onclick = async (ev: MouseEvent) => {
        const splitRoute = route.route.split(`/`);
        const curSplit = location.pathname.split('/');
        // loose last "part" of route
        curSplit.pop();

        ev.preventDefault();
        const routed = await this.router.navigate(splitRoute).catch(e => {
          console.error('routing error', e);
          return false;
        });
        if (!routed) {
          return;
        }
        /** delete the content, as it is now out of date! */
        window.scullyContent = undefined;
        /** check for the same route with different "data", and NOT a level higher (length) */
        if (curSplit.every((part, i) => splitRoute[i] === part) && splitRoute.length > curSplit.length) {
          /**
           * as Angular doesn't destroy the component if we stay on the same page,
           * we have to manually delete old content. Also we need to kick of loading
           * the new content. handlePage() takes care of that.
           */
          setTimeout(() => {
            const p = this.elm.parentElement;
            let cur = findComments(p, 'scullyContent-begin')[0] as HTMLElement;
            let next;
            do {
              next = cur.nextSibling;
              p.removeChild(cur);
              cur = next;
            } while (next && next !== this.elm);
            // tslint:disable-next-line: no-string-literal
            this.handlePage();
          }, 10); // a small delay, so we are sure the angular parts in the page are settled enough
        }
      };
    }
  }

  getCSSId(elm: HTMLElement) {
    return elm.getAttributeNames().find(a => a.startsWith('_ngcontent')) || 'none_found';
  }

  ngOnDestroy() {}
}
