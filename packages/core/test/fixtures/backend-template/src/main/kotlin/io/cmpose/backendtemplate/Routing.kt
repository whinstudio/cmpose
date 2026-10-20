package io.cmpose.backendtemplate

import io.cmpose.backendtemplate.feature.sample.ItemRepository
import io.cmpose.backendtemplate.feature.sample.itemRoutes

fun routing() {
    health()

    // cmpose:sample
    val items = ItemRepository()
    // cmpose:sharing-off: itemRoutes(items)
    itemRoutes(items, spaces)
    // /cmpose:sample

    // cmpose:sample-off: println("no features yet")
    println("features")
}
