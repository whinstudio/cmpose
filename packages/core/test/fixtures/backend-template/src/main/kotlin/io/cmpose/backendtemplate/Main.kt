package io.cmpose.backendtemplate

import io.cmpose.backendtemplate.config.AppConfig
import io.cmpose.backendtemplate.sharing.SpaceRepository
import io.cmpose.backendtemplate.sharing.Role
import java.util.UUID as Uid
import kotlinx.coroutines.*

fun main() {
    val config = AppConfig.load()

    // cmpose:sharing
    val spaces = SpaceRepository()
    println(Role.VIEWER)
    // /cmpose:sharing

    // cmpose:sharing-off: start(config, Uid.randomUUID())
    start(config, Uid.randomUUID(), spaces)
}
