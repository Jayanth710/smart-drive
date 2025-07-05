"use client"
import SettingsPage from '@/components/SettingsPage'
import SideBar from '@/components/SideBar'
import React from 'react'

const Settings = () => {
  return (
    <div>
      <SideBar>
        <SettingsPage />
      </SideBar>
    </div>
  )
}

export default Settings
