// 极简哈希路由器
export type RouteHandler = (params: Record<string, string>) => void | Promise<void>;

export class Router {
  private routes: { pattern: string; keys: string[]; re: RegExp; handler: RouteHandler }[] = [];
  private current: RouteHandler | null = null;

  on(pattern: string, handler: RouteHandler): this {
    const keys: string[] = [];
    const re = new RegExp(
      '^' +
        pattern.replace(/:([^/]+)/g, (_, k) => {
          keys.push(k);
          return '([^/]+)';
        }) +
        '$',
    );
    this.routes.push({ pattern, keys, re, handler });
    return this;
  }

  resolve(): void {
    const hash = location.hash.replace(/^#/, '') || '/';
    const [path, query] = hash.split('?');
    const qp: Record<string, string> = {};
    if (query) {
      for (const pair of query.split('&')) {
        const [k, v] = pair.split('=');
        if (k) qp[decodeURIComponent(k)] = decodeURIComponent(v ?? '');
      }
    }
    for (const r of this.routes) {
      const m = path.match(r.re);
      if (m) {
        const params: Record<string, string> = { ...qp };
        r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
        this.current = r.handler;
        Promise.resolve(r.handler(params));
        this.markNav(path);
        return;
      }
    }
    location.hash = '/route';
  }

  private markNav(path: string): void {
    const root = path.split('/')[1] || 'route';
    document.querySelectorAll('[data-nav]').forEach((el) => {
      el.classList.toggle('active', (el as HTMLElement).dataset.nav === root);
    });
  }

  start(): void {
    window.addEventListener('hashchange', () => this.resolve());
    this.resolve();
  }
}

export function go(path: string): void {
  location.hash = path;
}

export function currentPath(): string {
  return location.hash.replace(/^#/, '') || '/';
}
