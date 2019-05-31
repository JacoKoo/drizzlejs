import { Component } from './component'
import { Lifecycle } from './lifecycle'
import { View } from './view'
import { DrizzlePlugin, Application } from './drizzle'

interface ActionHandler {
    action: string
}

interface EventHandler {
    event: string
}

interface ComponentHandler {
    ref: string
    slot?: string
    model?: string
}

type Handler = DefaultHandler | ActionHandler | EventHandler | ComponentHandler | string

interface RouteOptions {
    [route: string]: Handler
}

declare module './component' {
    interface Component {
        _router?: Router
    }

    interface ComponentOptions {
        routes?: RouteOptions
    }
}

interface DefaultHandler {
    enter (args: object): Promise<Router>
    update? (args: object): Promise<any>
    leave? (): Promise<any>
}

interface MatchResult {
    remain: string[]
    consumed: string
    args?: object
}

// /name
class Token {
    protected key: string
    protected next: Token
    protected v = 9

    constructor(key: string, next: Token) {
        this.key = key
        this.next = next
    }

    match (keys: string[]): MatchResult | false {
        const c = keys[0]
        return this.doMatch(c, keys.slice(1))
    }

    value (v: number = 0): number {
        const vv = v + this.v
        return this.next ? this.next.value(vv * 10) : vv
    }

    protected doMatch (key: string, keys: string[]): MatchResult | false {
        if (key !== this.key) return false
        if (this.next) {
            const o = this.next.match(keys)
            if (!o) return false
            o.consumed = o.consumed ? `${key}/${o.consumed}` : key
            return o
        }
        return {remain: keys, consumed: key}
    }
}

// /:name
class ArgToken extends Token {
    v = 8
    doMatch (key: string, keys: string[]): MatchResult | false {
        const oo = {[this.key]: key}
        if (!this.next) return {remain: keys, args: oo, consumed: key}

        const o = this.next.match(keys)
        if (o === false) return false

        o.args ? Object.assign(o.args, oo) : (o.args = oo)
        if (key && o.consumed) o.consumed = `${key}/${o.consumed}`
        else if (key) o.consumed = key
        return o
    }
}

// /*name
class AllToken extends Token {
    v = 7
    match (keys: string[]): MatchResult | false {
        if (!keys.length) return false
        return { args: {[this.key]: keys}, remain: [], consumed: keys.join('/')}
    }
}

const create = (path) => {
    const ts = path.trim().split('/').filter(it => !!it)
    return ts.reduceRight((acc, item) => {
        if (item.charAt(0) === '*') return new AllToken(item.slice(1), acc)
        if (item.charAt(0) === ':') return new ArgToken(item.slice(1), acc)
        return new Token(item, acc)
    }, null)
}

class Router {
    _prefix: string

    private _component: Component
    private _keys: Token[] = []
    private _defs: DefaultHandler[] = []
    private _currentKey: number = -1
    private _next: Router
    private _previous: string[]

    constructor (comp: Component, routes: RouteOptions, prefix: string = '#/') {
        this._component = comp
        this._prefix = prefix
        this.initRoutes(routes)
    }

    route (keys: string[]) {
        for (let i = 0; i < this._keys.length; i ++) {
            const re = this._keys[i].match(keys)
            if (re) {
                return this.doRoute(i, re).then(d => {
                    this._previous = keys
                    return d
                })
            }
        }
        return Promise.resolve(false)
    }

    private leave (): Promise<any> {
        this._previous = undefined
        return Promise.resolve().then(() => {
            if (this._next) return this._next.leave()
        }).then(() => {
            const h = this._defs[this._currentKey]
            if (h && h.leave) return h.leave()
        })
    }

    private enter (idx: number, result: MatchResult) {
        this._currentKey = idx
        const o = Object.assign({_router_prefix: `${this._prefix}${result.consumed}/`}, result.args)
        return this._defs[idx].enter(o).then(it => {
            this._next = it
            if (it) return it.route(result.remain)
        })
    }

    private doRoute (idx: number, result: MatchResult): Promise<any> {
        const h = this._defs[idx]
        if (this._currentKey === -1) {
            return this.enter(idx, result)
        }
        if (idx === this._currentKey) {
            return Promise.resolve().then(() => {
                if (h.update) return h.update(result.args)
            }).then(() => {
                if (this._next) return this._next.route(result.remain)
            })
        }

        return this.leave().then(() => {
            return this.enter(idx, result)
        })
    }

    private initRoutes (routes: RouteOptions) {
        Object.keys(routes).map(key => {
            return { key, token: create(key) }
        }).sort((a, b) => b.token.value() - a.token.value()).forEach(it => {
            this._keys.push(it.token)
            this._defs.push(this.createHandler(routes[it.key]))
        })
    }

    private createHandler (h: Handler): DefaultHandler {
        if (typeof h === 'string') return this.createComponentHandler({ref: h})
        if ('enter' in h) return h as DefaultHandler
        if ('action' in h) return this.createActionHandler(h as ActionHandler)
        if ('event' in h) return this.createEventHandler(h as EventHandler)
        if ('ref' in h) return this.createComponentHandler(h as ComponentHandler)
        throw new Error('unsupported router handler')
    }

    private createActionHandler (h: ActionHandler) {
        return {
            enter: (args: object) => {
                return this._component._dispatch(h.action, args).then(() => null)
            },
            update: (args: object) => {
                return this._component._dispatch(h.action, args)
            }
        }
    }

    private createEventHandler (h: EventHandler) {
        return {
            enter: (args: object) => {
                this._component._event(h.event, args, this._previous)
                return Promise.resolve(null)
            },
            update: (args: object) => {
                this._component._event(h.event, args, this._previous)
                return Promise.resolve()
            }
        }
    }

    private createComponentHandler (h: ComponentHandler) {
        let item
        return {
            enter: (args: object) => {
                const o = h.model ? {[h.model]: args} : args
                return this._component._createItem(h.ref, o).then(it => {
                    const slot = this._component.slots[h.slot || 'default']
                    return slot.get().then(target => {
                        slot.setCleaner(w => w.wait(it.destroy()))
                        return it._render(target)
                    }).then(() => {
                        item = it
                        if (it instanceof Component) return it._router
                        return null
                    })
                })
            },

            update: (args: object) => {
                if (!args) return Promise.resolve()
                const o = h.model ? {[h.model]: args} : args
                if (item && (item instanceof Component)) return item.set(o)
                return Promise.resolve()
            }
        }
    }
}

const RouterComponentLifecycle: Lifecycle = {
    stage: 'init',
    init (this: Component) {
        const {routes} = this._options
        if (!routes) return
        const prefix = (this._extraState as any)._router_prefix
        this._router = new Router(this, routes, prefix)
    },

    collect (this: Component, data: object): object {
        const r = this._router
        if (r) data['@router'] = r._prefix
        return data
    }
}

const RouterViewLifecycle: Lifecycle = {
    collect (this: View, data: object): object {
        const r = this._component._router
        if (r) data['@router'] = r._prefix
        return data
    }
}

export const RouterPlugin: DrizzlePlugin = {
    componentLifecycles: [RouterComponentLifecycle],
    viewLifecycles: [RouterViewLifecycle],

    init (app: Application) {

    },

    started (item: Component) {
        const router = item._router
        if (!router) return
        const doIt = () => {
            const hash = window.location.hash
            if (hash.slice(0, 2) !== '#/') return
            const hs = hash.slice(2).split('/').filter(it => !!it)
            if (!hs.length) return
            router.route(hs).then(it => {
                console.log(it)
            })
        }

        window.addEventListener('popstate', doIt)
        doIt()
    }
}
