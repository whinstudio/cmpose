@file:Suppress("Filename")

package dev.cmpose.app.di

import dev.cmpose.app.core.insights.di.InsightsModule
import dev.cmpose.app.core.insights.installInsightsLogging
import dev.cmpose.app.core.navigation.NavigationModule
import org.koin.core.context.startKoin
import org.koin.ksp.generated.module
import org.koin.mp.KoinPlatform
import org.koin.core.module.Module as KoinModule

fun initKoin() {
    startKoin { modules(appModules()) }
    installInsightsLogging(KoinPlatform.getKoin().get())
}

fun appModules(): List<KoinModule> = buildList {
    add(NavigationModule().module)
    add(InsightsModule().module)
}
