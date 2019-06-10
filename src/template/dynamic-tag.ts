import { StaticTag, setAttribute } from './static-tag'
import { Context, Waiter, EventTarget, ViewContext } from './context'
import { ChangeType} from './common'

export class DynamicTag extends StaticTag {
    das: [string, string, boolean][] = []
    evs: string[]
    widgets: string[]
    bindings: string[]
    exists: boolean = false

    constructor (name: string, id: string, events: string[] = [], widgets: string[] = [], bds: string[] = []) {
        super(name, id)
        this.evs = events
        this.widgets = widgets
        this.bindings = bds
        this.exists = !!(events.length || widgets.length || bds.length)
    }

    dattr (name: string, helperId: string, useSet?: boolean) {
        this.das.push([name, helperId, useSet === true])
    }

    render (ctx: Context, waiter: Waiter) {
        super.render(ctx, waiter)
        this.updateAttrs(ctx)
        if (!this.evs.length && !this.widgets.length) return

        const el = ctx.getEl(this.id) as Element
        if (this.evs.length || this.bindings.length) {
            const ee = ctx.fillState(el)
            this.evs.forEach(it => ctx.event(false, ee, it))
            this.bindings.forEach(it => (ctx as ViewContext).bind(0, ee, it))
        }
        this.widgets.forEach(it => (ctx as ViewContext).widget(0, el, it))
    }

    update (ctx: Context, waiter: Waiter) {
        super.update(ctx, waiter)
        this.updateAttrs(ctx)
        const el = ctx.getEl(this.id) as Element

        if (this.evs.length || this.bindings.length) {
            const ee = ctx.fillState(el)
            this.bindings.forEach(it => (ctx as ViewContext).bind(1, ee, it))
        }
        this.widgets.forEach(it => (ctx as ViewContext).widget(1, el, it))
    }

    updateAttrs (ctx: Context) {
        const el = ctx.getEl(this.id)
        this.das.forEach(it => {
            const v = ctx.get(it[1])
            if (v[0] === ChangeType.CHANGED) {
                setAttribute(el as Element, [it[0], v[1], it[2]])
            // TODO temporally solve a bug
            } else if (this.name === 'input' && it[0] === 'checked') {
                setAttribute(el as Element, [it[0], v[1], it[2]])
            }
        })
    }

    destroy (ctx: Context, waiter: Waiter, domRemove: boolean) {
        const el = ctx.getEl(this.id) as Element
        if (this.evs.length || this.bindings.length) {
            const ee = el as any as EventTarget
            this.evs.forEach(it => ctx.event(true, ee, it))
            this.bindings.forEach(it => (ctx as ViewContext).bind(2, ee, it))
        }
        this.widgets.forEach(it => (ctx as ViewContext).widget(2, el, it))
        super.destroy(ctx, waiter, domRemove)
    }
}
