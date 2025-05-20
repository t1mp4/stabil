type Link = {
    dep: ReactiveNode;
    sub: Computation;
    prevSub?: Link | undefined;
    nextSub?: Link | undefined;
    prevDep?: Link | undefined;
    nextDep?: Link | undefined;
}

type Computation = Effect | Memo;

let globalEpoch = 0;

let RunningComputation: Computation | undefined;

function propagate(node: ReactiveNode) {
    let link = node.subsHead;
    
    while (link !== undefined) {
        const computation = link.sub;
        
        if (computation.markEpoch !== globalEpoch) {
            computation.markEpoch = globalEpoch;
            if (computation instanceof Effect) {
                computation.execute();
            } else {
                computation.accessor = computation.recompute;
                 if (computation.subsHead !== undefined) {
                    propagate(computation);
                }
            }
        }
        
        link = link.nextSub;
    }
}

export class ReactiveNode<T = any> {
    public subsHead?: Link;
    public subsTail?: Link;

    public constructor(private value: T) {}

    public get() {
        if (RunningComputation !== undefined) {
            const link: Link = {
                dep: this,
                sub: RunningComputation
            };
            if (this.subsTail !== undefined) {
                let l: Link | undefined = this.subsTail;
                do {
                    if (l.sub === RunningComputation) {
                        // Already subscribed ( e.g. createMemo(() => { foobar(); foobar(); } )
                        return this.value;
                    }
                    l = l.prevSub;
                } while (l !== undefined);

                link.prevSub = this.subsTail;
                if (RunningComputation.depsTail !== undefined) {
                    link.prevDep = RunningComputation.depsTail;
                    RunningComputation.depsTail.nextDep = link;
                    RunningComputation.depsTail = link;
                } else {
                    RunningComputation.depsHead = link;
                    RunningComputation.depsTail = link;
                }

                this.subsTail.nextSub = link;
                this.subsTail = link;
            } else {
                if (RunningComputation.depsTail !== undefined) {
                    link.prevDep = RunningComputation.depsTail;
                    RunningComputation.depsTail.nextDep = link;
                    RunningComputation.depsTail = link;
                } else {
                    RunningComputation.depsHead = link;
                    RunningComputation.depsTail = link;
                }
                this.subsHead = link;
                this.subsTail = link;
            }
        }

        return this.value;
    }

    public set(value: T) {
        if (value !== this.value) {
            this.value = value;

            if (globalEpoch !== Number.MAX_SAFE_INTEGER) {
                globalEpoch++;
            } else {
                globalEpoch = 0;
            }

            if (this.subsHead !== undefined) {
                propagate(this);
            }
        }
    }
}

function reset(obj: { depsHead?: Link | undefined; depsTail?: Link | undefined }) {
    let dep = obj.depsHead;
    while (dep !== undefined) {
        if (dep.prevSub !== undefined) {
            // dep has a previous sub, so it cannot be the head
            dep.prevSub.nextSub = dep.nextSub; // Can be undefined
            if (dep.nextSub !== undefined) {
                // dep also has a next sub, so it cannot be the tail either
                dep.nextSub.prevSub = dep.prevSub;
            } else {
                // dep is the tail. Update it
                dep.dep.subsTail = dep.prevSub;
            }
        } else {
            // dep has no previous sub. It must be the head.
            dep.dep.subsHead = dep.nextSub; // Can be undefined
            if (dep.nextSub !== undefined) {
                dep.nextSub.prevSub = undefined;
            } else {
                // dep is the only sub
                dep.dep.subsTail = undefined;
            }
        }

        dep = dep.nextDep;
    }

    obj.depsHead = undefined;
    obj.depsTail = undefined;
}

class Effect {
    public depsHead?: Link | undefined;
    public depsTail?: Link | undefined;

    public markEpoch = -1;

    public constructor(public readonly fn: () => void) {
        this.execute();
    }

    public execute() {
        reset(this);
        if (RunningComputation !== undefined) {
            const prevComputation = RunningComputation;
            RunningComputation = this;
            this.fn();
            RunningComputation = prevComputation;
        } else {
            RunningComputation = this;
            this.fn();
            RunningComputation = undefined;
        }
    }
}

class Memo<T = any> extends ReactiveNode<T> {
    public depsHead?: Link | undefined;
    public depsTail?: Link | undefined;

    public accessor = this.recompute;

    public markEpoch = -1;

    public constructor(public readonly fn: () => T) {
        // @ts-expect-error
        super();
    }

    public recompute() {
        reset(this);
        if (RunningComputation !== undefined) {
            const prevComputation = RunningComputation;
            RunningComputation = this;
            this.set(this.fn());
            RunningComputation = prevComputation;
        } else {
            RunningComputation = this;
            this.set(this.fn());
            RunningComputation = undefined;
        }

        this.accessor = this.get;
        return this.get();
    }
}