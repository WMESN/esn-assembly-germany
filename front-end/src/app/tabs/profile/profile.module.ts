import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { IDEATranslationsModule } from '@idea-ionic/common';

import { ProfileRoutingModule } from './profile.routing.module';
import { ProfilePage } from './profile.page';

@NgModule({
  imports: [CommonModule, FormsModule, IonicModule, IDEATranslationsModule, ProfileRoutingModule],
  declarations: [ProfilePage]
})
export class ProfileModule {}
